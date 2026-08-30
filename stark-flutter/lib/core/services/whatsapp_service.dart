// STARK HELP CENTER — WhatsApp Support Service.
//
// Architecture (never inline in widgets):
//
//   WhatsAppService
//     ↓ validateTicket()          exact spec error messages
//     ↓ createSupportMessage()    professional ticket body
//     ↓ Uri.encodeComponent()     spaces, ₦, newlines — all encoded
//     ↓ buildWhatsAppUrl()        https://wa.me/2347047576657?text=…
//     ↓ launchUrl(externalApplication)
//
// The app can NEVER send the message silently: WhatsApp opens with the
// message pre-filled and the USER taps Send. No secrets live here —
// the support number is public information.
import 'package:url_launcher/url_launcher.dart';

/// Stark Help Center WhatsApp number — international format, no '+'.
/// wa.me requires exactly this shape: 2347047576657.
const String kStarkWhatsAppNumber = '2347047576657';
const String kStarkWhatsAppDisplay = '+234 704 757 6657';

class TicketValidationException implements Exception {
  TicketValidationException(this.message);
  final String message;
  @override
  String toString() => message;
}

class WhatsAppUnavailableException implements Exception {
  const WhatsAppUnavailableException();
  @override
  String toString() => 'WhatsApp is not available on this device.';
}

class SupportUser {
  const SupportUser({required this.name, required this.phone, required this.email});
  final String name, phone, email;
}

class SupportTransaction {
  const SupportTransaction({
    required this.id,
    required this.service,
    required this.amount,
    required this.status,
    this.provider,
  });
  final String id; // Stark reference, e.g. STK-20260823-8F42A91C
  final String service; // e.g. "MTN 10GB Data"
  final String amount; // formatted, e.g. "₦5,000"
  final String status;
  final String? provider;
}

class WhatsAppService {
  static const String _rule = '------------------------------';

  /// STEP 1–4 of the submit flow: required-field validation + trim.
  /// Throws [TicketValidationException] with the exact spec messages so
  /// the UI can show them verbatim and keep the form intact.
  Map<String, String> validateTicket({
    required String subject,
    required String category,
    required String description,
  }) {
    final s = subject.trim();
    final c = category.trim();
    final d = description.trim();
    if (s.isEmpty) throw TicketValidationException('Please enter a subject.');
    if (c.isEmpty) throw TicketValidationException('Please select a category.');
    if (d.isEmpty) throw TicketValidationException('Please describe the issue.');
    return {'subject': s, 'category': c, 'description': d};
  }

  /// STEP 5 — the professional support message, per spec.
  String createSupportMessage({
    required String subject,
    required String category,
    required String description,
    String? ticketId, // minted by the Go backend (STK-TKT-000184)
    SupportUser? user, // already known to Stark — never re-asked
    SupportTransaction? tx, // attached when opened from a transaction
  }) {
    final b = StringBuffer();
    b.writeln('🆘 STARK TELECOMMUNICATION');
    b.writeln('SUPPORT TICKET');
    b.writeln();

    if (ticketId != null) {
      b.writeln('Ticket ID:');
      b.writeln(ticketId);
      b.writeln();
    }

    b.writeln('Subject:');
    b.writeln(subject);
    b.writeln();
    b.writeln('Category:');
    b.writeln(category);
    b.writeln();

    if (user != null) {
      b.writeln('Customer:');
      b.writeln(user.name);
      b.writeln();
      b.writeln('Phone:');
      b.writeln(user.phone);
      b.writeln();
      b.writeln('Email:');
      b.writeln(user.email);
      b.writeln();
    }

    if (tx != null) {
      b.writeln('Transaction ID:');
      b.writeln(tx.id);
      b.writeln();
      b.writeln('Service:');
      b.writeln(tx.service);
      b.writeln();
      b.writeln('Amount:');
      b.writeln(tx.amount);
      b.writeln();
      b.writeln('Transaction status:');
      b.writeln(tx.status);
      if (tx.provider != null) {
        b.writeln();
        b.writeln('Provider:');
        b.writeln(tx.provider);
      }
      b.writeln();
    }

    b.writeln('Description:');
    b.writeln(description);
    b.writeln();
    b.writeln(_rule);
    b.writeln('STARK HELP CENTER');
    b.writeln('Please assist with this issue.');
    b.write(_rule);
    return b.toString();
  }

  /// wa.me deep link. The message is fully URL-encoded — spaces, ₦
  /// signs, newlines and emojis are all handled by Uri.encodeComponent.
  Uri buildWhatsAppUrl(String message) =>
      Uri.parse('https://wa.me/$kStarkWhatsAppNumber?text=${Uri.encodeComponent(message)}');

  /// WhatsApp Web fallback with the same encoded message.
  Uri buildWhatsAppWebUrl(String message) => Uri.parse(
      'https://web.whatsapp.com/send?phone=$kStarkWhatsAppNumber&text=${Uri.encodeComponent(message)}');

  /// Opens WhatsApp externally with the prepared message.
  ///
  /// Returns the message so the UI can offer copy/web fallbacks; throws
  /// [WhatsAppUnavailableException] when WhatsApp cannot be opened —
  /// callers MUST keep the user's form intact for retry.
  Future<String> sendSupportTicket({
    required String subject,
    required String category,
    required String description,
    String? ticketId,
    SupportUser? user,
    SupportTransaction? tx,
  }) async {
    final clean = validateTicket(subject: subject, category: category, description: description);
    final message = createSupportMessage(
      subject: clean['subject']!,
      category: clean['category']!,
      description: clean['description']!,
      ticketId: ticketId,
      user: user,
      tx: tx,
    );

    final uri = buildWhatsAppUrl(message);
    if (!await canLaunchUrl(uri)) {
      throw const WhatsAppUnavailableException();
    }
    final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!launched) throw const WhatsAppUnavailableException();
    return message; // UI shows: "Your support message is ready in WhatsApp."
  }

  /// Opens WhatsApp Web as the graceful fallback.
  Future<bool> openWhatsAppWeb(String message) =>
      launchUrl(buildWhatsAppWebUrl(message), mode: LaunchMode.externalApplication);
}
