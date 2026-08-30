// Package payments is Stark's payment-gateway abstraction.
//
// STARK owns the wallet, ledger and business rules; a Gateway is only a
// processor of customer money. This seam lets Paystack be swapped for —
// or joined by — another processor (e.g. Remita) without touching the
// financial core (finance.Post, the state machine, idempotency).
//
// SECURITY INVARIANTS (production, live money):
//   - The gateway's secret key lives ONLY in server environment config.
//     It is never logged, never returned in an API response, and never
//     shipped to Flutter.
//   - A gateway result is untrusted input: every payment is re-verified
//     server-to-server and compared against the Stark-recorded amount,
//     currency and owner BEFORE any ledger credit.
package payments

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"stark-api/internal/platform"
)

// Sentinel errors — callers map these to safe customer-facing messages.
var (
	ErrUnconfigured  = errors.New("payment gateway not configured")
	ErrUnreachable   = errors.New("payment gateway unreachable")
	ErrRejected      = errors.New("payment gateway rejected the request")
	ErrInvalidEvent  = errors.New("payment event failed verification")
)

/* ------------------------- abstraction ------------------------- */

// InitRequest is everything Stark needs to start a hosted charge.
// AmountKobo is integer minor units (1 NGN = 100 kobo) — floats are
// never used for money anywhere in Stark (§13).
type InitRequest struct {
	Email       string
	AmountKobo  int64
	Reference   string         // Stark-generated, cryptographically random
	CallbackURL string         // where Paystack redirects the customer after paying
	Metadata    map[string]any // safe metadata echoed back by the gateway
}

// InitResult is client-safe payment-start information. It deliberately
// excludes any authorization secret.
type InitResult struct {
	AuthorizationURL string
	AccessCode       string
	Reference        string
}

// VerifyResult is the server-to-server truth about a charge.
type VerifyResult struct {
	Status        string // "success" | "failed" | "abandoned" | "pending"
	AmountKobo    int64
	Currency      string
	TransactionID int64  // the gateway's numeric transaction id
	Channel       string // card | bank | ussd | ...
}

// Gateway is the contract every payment processor must satisfy.
type Gateway interface {
	Name() string
	Initialize(ctx context.Context, req InitRequest) (InitResult, error)
	Verify(ctx context.Context, reference string) (VerifyResult, error)
	// VerifyWebhookSignature authenticates a raw webhook body. It must be
	// constant-time and use the server-side secret.
	VerifyWebhookSignature(payload []byte, signature string) bool
}

/* ------------------------- Paystack ---------------------------- */

// Paystack implements Gateway against the official Paystack REST API.
// https://paystack.com/docs/api — /transaction/initialize, /transaction/verify.
type Paystack struct {
	baseURL   string
	secretKey string
	httpc     *http.Client
}

func NewPaystack(baseURL, secretKey string) *Paystack {
	if baseURL == "" {
		baseURL = "https://api.paystack.co"
	}
	return &Paystack{
		baseURL:   baseURL,
		secretKey: secretKey,
		httpc:     &http.Client{Timeout: 20 * time.Second},
	}
}

func (p *Paystack) Name() string { return "paystack" }

// Initialize starts a hosted charge. Stark supplies its OWN reference so
// the payment record and the gateway charge share one identity and the
// PENDING row exists before any money moves.
func (p *Paystack) Initialize(ctx context.Context, req InitRequest) (InitResult, error) {
	if p.secretKey == "" {
		return InitResult{}, ErrUnconfigured
	}
	body, _ := json.Marshal(map[string]any{
		"email":        req.Email,
		"amount":       req.AmountKobo, // Paystack expects integer kobo
		"currency":     "NGN",
		"reference":    req.Reference,
		"callback_url": req.CallbackURL,
		"metadata":     req.Metadata,
	})
	hreq, err := http.NewRequestWithContext(ctx, "POST", p.baseURL+"/transaction/initialize", bytes.NewReader(body))
	if err != nil {
		return InitResult{}, ErrUnreachable
	}
	hreq.Header.Set("Authorization", "Bearer "+p.secretKey)
	hreq.Header.Set("Content-Type", "application/json")

	resp, err := p.httpc.Do(hreq)
	if err != nil {
		return InitResult{}, ErrUnreachable
	}
	defer resp.Body.Close()

	var out struct {
		Status  bool   `json:"status"`
		Message string `json:"message"`
		Data    struct {
			AuthorizationURL string `json:"authorization_url"`
			AccessCode       string `json:"access_code"`
			Reference        string `json:"reference"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return InitResult{}, ErrRejected
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !out.Status || out.Data.AuthorizationURL == "" {
		// Never echo the gateway's raw message to clients — it can leak
		// internal detail. Log-worthy server-side only.
		return InitResult{}, fmt.Errorf("%w: initialize", ErrRejected)
	}
	ref := out.Data.Reference
	if ref == "" {
		ref = req.Reference
	}
	return InitResult{
		AuthorizationURL: out.Data.AuthorizationURL,
		AccessCode:       out.Data.AccessCode,
		Reference:        ref,
	}, nil
}

// Verify is the authoritative server-to-server check for a reference.
// It is called from BOTH the webhook path and the reconciliation worker,
// so a payment is never credited on the customer's word.
func (p *Paystack) Verify(ctx context.Context, reference string) (VerifyResult, error) {
	if p.secretKey == "" {
		return VerifyResult{}, ErrUnconfigured
	}
	hreq, err := http.NewRequestWithContext(ctx, "GET", p.baseURL+"/transaction/verify/"+reference, nil)
	if err != nil {
		return VerifyResult{}, ErrUnreachable
	}
	hreq.Header.Set("Authorization", "Bearer "+p.secretKey)

	resp, err := p.httpc.Do(hreq)
	if err != nil {
		return VerifyResult{}, ErrUnreachable
	}
	defer resp.Body.Close()

	var out struct {
		Status bool   `json:"status"`
		Data   struct {
			ID       int64  `json:"id"`
			Status   string `json:"status"`
			Amount   int64  `json:"amount"`
			Currency string `json:"currency"`
			Channel  string `json:"channel"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return VerifyResult{}, ErrInvalidEvent
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !out.Status {
		return VerifyResult{}, fmt.Errorf("%w: verify", ErrRejected)
	}
	return VerifyResult{
		Status:        out.Data.Status,
		AmountKobo:    out.Data.Amount,
		Currency:      out.Data.Currency,
		TransactionID: out.Data.ID,
		Channel:       out.Data.Channel,
	}, nil
}

// VerifyWebhookSignature implements Paystack's documented webhook
// authentication: HMAC-SHA512 of the RAW request body with the secret
// key, compared against the x-paystack-signature header in constant time.
func (p *Paystack) VerifyWebhookSignature(payload []byte, signature string) bool {
	if p.secretKey == "" || signature == "" {
		return false
	}
	return platform.ConstantTimeEqualHex(platform.HMACSHA512Hex(p.secretKey, payload), signature)
}
