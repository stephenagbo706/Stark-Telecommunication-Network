// STARK domain models — Freezed + json_serializable.
//
// Immutable, copyable, exhaustively pattern-matchable. Generated with:
//   dart run build_runner build --delete-conflicting-outputs
//
// All money travels as int kobo. The app NEVER computes wallet balances
// locally — `WalletBalances` is always the server's ledger-derived truth.
import 'package:freezed_annotation/freezed_annotation.dart';

part 'models.freezed.dart';
part 'models.g.dart';

/* ============================== AUTH =============================== */

@freezed
class AuthTokens with _$AuthTokens {
  const factory AuthTokens({
    @JsonKey(name: 'access_token') required String accessToken,
    @JsonKey(name: 'refresh_token') required String refreshToken,
  }) = _AuthTokens;
  factory AuthTokens.fromJson(Map<String, dynamic> json) => _$AuthTokensFromJson(json);
}

@freezed
class StarkUser with _$StarkUser {
  const factory StarkUser({
    @JsonKey(name: 'user_id') required String userId,
    required String name,
    required String email,
    required String phone,
    @JsonKey(name: 'referral_code') @Default('') String referralCode,
    @JsonKey(name: 'profile_image_url') @Default('') String photoUrl,
    @JsonKey(name: 'pin_set') @Default(false) bool pinSet,
    @JsonKey(name: 'two_factor_enabled') @Default(false) bool twoFactor,
    @JsonKey(name: 'status') @Default('active') String status,
  }) = _StarkUser;
  factory StarkUser.fromJson(Map<String, dynamic> json) => _$StarkUserFromJson(json);
}

/* ============================ FINANCE ============================== */

@freezed
class WalletBalances with _$WalletBalances {
  const factory WalletBalances({
    @JsonKey(name: 'available_kobo') @Default(0) int availableKobo,
    @JsonKey(name: 'reserved_kobo') @Default(0) int reservedKobo,
    @JsonKey(name: 'cashback_kobo') @Default(0) int cashbackKobo,
  }) = _WalletBalances;
  factory WalletBalances.fromJson(Map<String, dynamic> json) => _$WalletBalancesFromJson(json);

  const WalletBalances._();
  double get available => availableKobo / 100;
  bool get hasReservation => reservedKobo > 0;
}

@freezed
class LedgerEntry with _$LedgerEntry {
  const factory LedgerEntry({
    @JsonKey(name: 'posting_id') required String postingId,
    @JsonKey(name: 'account_kind') required String accountKind,
    required String direction, // DEBIT | CREDIT — entries are immutable
    @JsonKey(name: 'amount_kobo') required int amountKobo,
    required String description,
    @JsonKey(name: 'created_at') required DateTime createdAt,
  }) = _LedgerEntry;
  factory LedgerEntry.fromJson(Map<String, dynamic> json) => _$LedgerEntryFromJson(json);
}

@freezed
class StarkTx with _$StarkTx {
  const factory StarkTx({
    required String id,
    required String ref, // STK-YYYYMMDD-XXXXXXXX
    required String service,
    @Default('') String network,
    @Default('') String account,
    @JsonKey(name: 'total_kobo') @Default(0) int totalKobo,
    required TxStatus status,
    @Default('') String token,
    @JsonKey(name: 'provider_ref') @Default('') String providerRef,
    @JsonKey(name: 'failure_reason') String? failureReason,
    @JsonKey(name: 'created_at') required DateTime createdAt,
  }) = _StarkTx;
  factory StarkTx.fromJson(Map<String, dynamic> json) => _$StarkTxFromJson(json);
}

enum TxStatus {
  @JsonValue('PENDING') pending,
  @JsonValue('PROCESSING') processing,
  @JsonValue('SUCCESSFUL') successful,
  @JsonValue('FAILED') failed,
  @JsonValue('REVERSED') reversed,
  @JsonValue('REFUNDED') refunded,
  @JsonValue('CANCELLED') cancelled;

  bool get terminal =>
      this == successful || this == failed || this == reversed || this == refunded || this == cancelled;
}

/* ============================== VTU ================================ */

@freezed
class DataPlan with _$DataPlan {
  const factory DataPlan({
    @JsonKey(name: 'plan_id') required String planId,
    required String network,
    required String label,
    @JsonKey(name: 'amount_kobo') required int amountKobo,
    @Default('') String validity,
    @JsonKey(name: 'cashback_kobo') @Default(0) int cashbackKobo,
  }) = _DataPlan;
  factory DataPlan.fromJson(Map<String, dynamic> json) => _$DataPlanFromJson(json);
}

@freezed
class CableValidation with _$CableValidation {
  // Customer identity comes from the provider only — never fabricated.
  const factory CableValidation({
    required String iuc,
    @JsonKey(name: 'customer_name') required String customerName,
    required List<String> packages,
  }) = _CableValidation;
  factory CableValidation.fromJson(Map<String, dynamic> json) => _$CableValidationFromJson(json);
}

@freezed
class PurchaseResult with _$PurchaseResult {
  const factory PurchaseResult({
    @JsonKey(name: 'transaction_id') required String transactionId,
    required String ref,
    required TxStatus status,
    @Default('') String message,
    @Default('') String token, // electricity token — provider-issued only
    @Default(false) bool reversed,
  }) = _PurchaseResult;
  factory PurchaseResult.fromJson(Map<String, dynamic> json) => _$PurchaseResultFromJson(json);
}

/* ============================= SUPPORT ============================= */

@freezed
class Dispute with _$Dispute {
  const factory Dispute({
    required String id,
    @JsonKey(name: 'transaction_id') required String transactionId,
    required DisputeStatus status,
    required String reason,
    @JsonKey(name: 'created_at') required DateTime createdAt,
  }) = _Dispute;
  factory Dispute.fromJson(Map<String, dynamic> json) => _$DisputeFromJson(json);
}

enum DisputeStatus {
  @JsonValue('OPEN') open,
  @JsonValue('UNDER_REVIEW') underReview,
  @JsonValue('WAITING_PROVIDER') waitingProvider,
  @JsonValue('RESOLVED') resolved,
  @JsonValue('REJECTED') rejected,
  @JsonValue('REFUNDED') refunded,
}
