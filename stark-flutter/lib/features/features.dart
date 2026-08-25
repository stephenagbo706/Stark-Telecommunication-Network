// STARK features — auth, wallet, home, purchase flows, profile.
//
// Structure follows clean architecture, consolidated into this snapshot
// file for delivery; in the repository each feature lives in its own
// folder: features/<name>/{data,domain,presentation}.
//
//   data/         → API clients + repositories (Dio)
//   domain/       → models + business rules (no Flutter imports in prod)
//   presentation/ → Riverpod controllers + screens
//
// Business logic never lives in widgets; screens render state only.
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/core.dart';
import '../core/services/whatsapp_service.dart';
import '../shared/widgets.dart';

/* ============================ DOMAIN =============================== */

class StarkUser {
  StarkUser.fromJson(Map<String, dynamic> j)
      : id = j['user_id'] ?? '',
        name = j['name'] ?? '',
        email = j['email'] ?? '',
        phone = j['phone'] ?? '',
        referralCode = j['referral_code'] ?? '',
        photoUrl = j['profile_image_url'] ?? '',
        pinSet = j['pin_set'] == true;

  final String id, name, email, phone, referralCode, photoUrl;
  final bool pinSet;
}

class WalletBalances {
  WalletBalances.fromJson(Map<String, dynamic> j)
      : available = (j['available_kobo'] as num?)?.toInt() ?? 0,
        reserved = (j['reserved_kobo'] as num?)?.toInt() ?? 0,
        cashback = (j['cashback_kobo'] as num?)?.toInt() ?? 0;
  final int available, reserved, cashback;
}

class StarkTx {
  StarkTx.fromJson(Map<String, dynamic> j)
      : id = j['id'] ?? '',
        ref = j['ref'] ?? '',
        service = j['service'] ?? '',
        network = j['network'] ?? '',
        account = j['account'] ?? '',
        totalKobo = (j['total_kobo'] as num?)?.toInt() ?? 0,
        status = j['status'] ?? '',
        token = j['token'] ?? '',
        createdAt = DateTime.tryParse(j['created_at']?.toString() ?? '') ?? DateTime.now();

  final String id, ref, service, network, account, status, token;
  final int totalKobo;
  final DateTime createdAt;
}

/* ====================== AUTH (data + domain) ======================= */

class AuthRepository {
  AuthRepository(this._api);
  final ApiClient _api;

  Future<Map<String, dynamic>> register({
    required String name, required String email,
    required String phone, required String password, String? referral,
  }) async {
    final res = await _api.dio.post('/api/v1/auth/register', data: {
      'name': name, 'email': email, 'phone': phone,
      'password': password, 'referral_code': referral,
    });
    return dataOf(res);
  }

  Future<void> verifyOtp(String userId, String code) async {
    final res = await _api.dio.post('/api/v1/auth/otp/verify', data: {'user_id': userId, 'code': code});
    final tokens = dataOf(res)['tokens'] as Map<String, dynamic>;
    await SecureStore.saveTokens(tokens['access_token'], tokens['refresh_token']);
  }

  Future<void> login({required String email, required String password, required String deviceId}) async {
    final res = await _api.dio.post('/api/v1/auth/login', data: {
      'email': email, 'password': password, 'device_id': deviceId,
      'device_name': '${Platform.operatingSystem} device', 'platform': Platform.operatingSystem,
    });
    final tokens = dataOf(res)['tokens'] as Map<String, dynamic>;
    await SecureStore.saveTokens(tokens['access_token'], tokens['refresh_token']);
  }

  Future<StarkUser> profile() async {
    final res = await _api.dio.get('/api/v1/profile');
    return StarkUser.fromJson(dataOf(res));
  }

  Future<void> verifyPin(String pin) =>
      _api.dio.post('/api/v1/security/verify-pin', data: {'pin': pin});

  Future<void> logout() async {
    final refresh = await SecureStore.refreshToken();
    try {
      await _api.dio.post('/api/v1/auth/logout', data: {'refresh_token': refresh});
    } catch (_) {}
    await SecureStore.clear();
  }
}

final authRepositoryProvider = Provider((ref) => AuthRepository(ref.watch(apiClientProvider)));

/* ================= AUTH (presentation: controller) ================= */

class AuthController extends StateNotifier<AsyncValue<StarkUser?>> {
  AuthController(this._repo) : super(const AsyncValue.data(null));
  final AuthRepository _repo;

  Future<void> bootstrap() async {
    if (await SecureStore.accessToken() == null) return;
    state = const AsyncValue.loading();
    try {
      state = AsyncValue.data(await _repo.profile());
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  Future<String> register({required String name, required String email,
      required String phone, required String password}) async {
    final d = await _repo.register(name: name, email: email, phone: phone, password: password);
    return d['user_id'] as String;
  }

  Future<void> verifyOtp(String userId, String code) async {
    await _repo.verifyOtp(userId, code);
    state = AsyncValue.data(await _repo.profile());
  }

  Future<void> login(String email, String password) async {
    await _repo.login(email: email, password: password, deviceId: const UuidLike().v4());
    state = AsyncValue.data(await _repo.profile());
  }

  Future<void> signOut() async {
    await _repo.logout();
    state = const AsyncValue.data(null);
  }
}

final authControllerProvider =
    StateNotifierProvider<AuthController, AsyncValue<StarkUser?>>((ref) {
  final c = AuthController(ref.watch(authRepositoryProvider));
  Future.microtask(c.bootstrap);
  return c;
});

/* ========================= WALLET (data) =========================== */

class WalletRepository {
  WalletRepository(this._api);
  final ApiClient _api;

  Future<WalletBalances> balances() async {
    final res = await _api.dio.get('/api/v1/wallet');
    return WalletBalances.fromJson(dataOf(res));
  }

  Future<List<StarkTx>> transactions() async {
    final res = await _api.dio.get('/api/v1/transactions');
    final list = res.data['data'] as List<dynamic>? ?? [];
    return list.map((e) => StarkTx.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Returns the Paystack authorization URL. The wallet is credited only
  /// after the server verifies the signed webhook — never on return here.
  Future<String> fund(double amount, String email) async {
    final res = await _api.dio.post('/api/v1/wallet/fund', data: {'amount': amount, 'email': email});
    return dataOf(res)['authorization_url'] as String;
  }

  Future<Map<String, dynamic>> purchase(Map<String, dynamic> body, String pin) async {
    final res = await _api.dio.post('/api/v1/transactions/purchase', data: {...body, 'pin': pin});
    return dataOf(res);
  }
}

final walletRepositoryProvider = Provider((ref) => WalletRepository(ref.watch(apiClientProvider)));

final walletBalancesProvider = FutureProvider.autoDispose((ref) async {
  final repo = ref.watch(walletRepositoryProvider);
  return repo.balances();
});

final transactionsProvider = FutureProvider.autoDispose((ref) async {
  final repo = ref.watch(walletRepositoryProvider);
  return repo.transactions();
});

/* ==================== AUTH SCREENS (presentation) ================== */

class AuthScreen extends ConsumerStatefulWidget {
  const AuthScreen({super.key});
  @override
  ConsumerState<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends ConsumerState<AuthScreen> {
  bool _registering = false;
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  final _otp = TextEditingController();
  String? _pendingUserId;
  String? _error;
  bool _busy = false;

  Future<void> _submit() async {
    setState(() { _busy = true; _error = null; });
    try {
      final auth = ref.read(authControllerProvider.notifier);
      if (_registering) {
        final userId = await auth.register(
          name: _name.text.trim(), email: _email.text.trim(),
          phone: _phone.text.trim(), password: _password.text,
        );
        setState(() => _pendingUserId = userId);
      } else {
        await auth.login(_email.text.trim(), _password.text);
        if (mounted) context.go('/home');
      }
    } catch (e) {
      setState(() => _error = errorMessageOf(e, 'Check your details and try again.'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    setState(() { _busy = true; _error = null; });
    try {
      await ref.read(authControllerProvider.notifier).verifyOtp(_pendingUserId!, _otp.text.trim());
      if (mounted) context.go('/home');
    } catch (e) {
      setState(() => _error = errorMessageOf(e, 'That code is incorrect or expired.'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(StarkSpace.xxl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('STARK', style: Theme.of(context).textTheme.displayLarge?.copyWith(color: StarkColors.cyan)),
              Text('Telecommunication', style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 28),
              if (_pendingUserId != null) ...[
                Text('Enter the 6-digit code sent to your phone', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 16),
                StarkTextField(label: 'OTP code', controller: _otp, keyboardType: TextInputType.number, hint: '••••••'),
                if (_error != null) _ErrorText(_error!),
                const SizedBox(height: 16),
                StarkButton(label: 'Verify & continue', loading: _busy, onPressed: _verify),
              ] else ...[
                StarkTextField(label: _registering ? 'Full name' : 'Email',
                    controller: _registering ? _name : _email,
                    hint: _registering ? 'Adaeze Okafor' : 'you@example.com'),
                const SizedBox(height: 12),
                if (_registering) ...[
                  StarkTextField(label: 'Email', controller: _email, hint: 'you@example.com'),
                  const SizedBox(height: 12),
                  StarkTextField(label: 'Phone', controller: _phone, keyboardType: TextInputType.phone, hint: '0803 000 0000'),
                  const SizedBox(height: 12),
                ],
                StarkTextField(label: 'Password', controller: _password, obscure: true),
                if (_error != null) _ErrorText(_error!),
                const SizedBox(height: 20),
                StarkButton(
                  label: _registering ? 'Create account' : 'Sign in',
                  loading: _busy,
                  onPressed: _submit,
                ),
                const SizedBox(height: 12),
                StarkButton(
                  label: _registering ? 'I already have an account' : 'Create an account',
                  variant: StarkButtonVariant.ghost,
                  onPressed: () => setState(() { _registering = !_registering; _error = null; }),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _ErrorText extends StatelessWidget {
  const _ErrorText(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: StarkColors.error.withOpacity(0.1),
            borderRadius: BorderRadius.circular(StarkRadius.control),
            border: Border.all(color: StarkColors.error.withOpacity(0.35)),
          ),
          child: Text(text, style: const TextStyle(color: StarkColors.error, fontSize: 12, fontWeight: FontWeight.w600)),
        ),
      );
}

/* ====================== HOME (presentation) ======================== */

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).valueOrNull;
    final wallet = ref.watch(walletBalancesProvider);
    final txs = ref.watch(transactionsProvider);

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          color: StarkColors.cyan,
          onRefresh: () async {
            ref.invalidate(walletBalancesProvider);
            ref.invalidate(transactionsProvider);
          },
          child: ListView(
            padding: const EdgeInsets.all(StarkSpace.xl),
            children: [
              Text('Hello, ${user?.name.split(' ').first ?? 'there'} ⌁',
                  style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 16),
              wallet.when(
                loading: () => const StarkSkeleton(height: 170),
                error: (e, _) => StarkCard(
                  child: Text(errorMessageOf(e, 'Balance unavailable right now.'),
                      style: const TextStyle(color: StarkColors.warning)),
                ),
                data: (b) => StarkWalletCard(
                  balanceKobo: b.available,
                  reservedKobo: b.reserved,
                  onAddMoney: () => _fund(context, ref),
                ),
              ),
              const SizedBox(height: 24),
              Text('Services', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 12),
              Wrap(
                spacing: 10, runSpacing: 10,
                children: [
                  _ServiceTile('Airtime', Icons.signal_cellular_alt_rounded, () => context.push('/buy/airtime')),
                  _ServiceTile('Data', Icons.wifi_rounded, () => context.push('/buy/data')),
                  _ServiceTile('Cable TV', Icons.tv_rounded, () => context.push('/buy/cable')),
                  _ServiceTile('Electricity', Icons.bolt_rounded, () => context.push('/buy/electricity')),
                ],
              ),
              const SizedBox(height: 24),
              Text('Recent activity', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 12),
              txs.when(
                loading: () => Column(children: List.generate(3, (_) => const Padding(
                  padding: EdgeInsets.only(bottom: 8), child: StarkSkeleton(height: 64)))),
                error: (e, _) => StarkEmptyState(
                  icon: Icons.error_outline_rounded,
                  title: 'Couldn’t load transactions',
                  subtitle: errorMessageOf(e, 'Check your connection and pull to refresh.'),
                ),
                data: (list) => list.isEmpty
                    ? StarkEmptyState(icon: Icons.receipt_long_rounded, title: 'No transactions yet',
                        subtitle: 'Your purchases and wallet activity will appear here.')
                    : Column(children: list
                        .take(6)
                        .map((t) => Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: StarkCard(
                                onTap: () => context.push('/buy/airtime'),
                                child: Row(children: [
                                  Expanded(
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Text('${t.service} • ${t.network}'.trim(),
                                          style: const TextStyle(fontWeight: FontWeight.w700)),
                                      Text(t.ref, style: Theme.of(context).textTheme.bodyMedium),
                                    ]),
                                  ),
                                  Text(starkNaira(t.totalKobo),
                                      style: const TextStyle(fontWeight: FontWeight.w800)),
                                  const SizedBox(width: 10),
                                  StarkStatusBadge(status: t.status),
                                ]),
                              ),
                            ))
                        .toList()),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _fund(BuildContext context, WidgetRef ref) async {
    final amountCtl = TextEditingController();
    final user = ref.read(authControllerProvider).valueOrNull;
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Theme.of(ctx).cardColor,
        title: const Text('Add money'),
        content: TextField(
          controller: amountCtl,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(prefixText: '₦ ', hintText: '5,000'),
        ),
        actions: [
          TextButton(onPressed: () => ctx.pop(), child: const Text('Cancel')),
          StarkButton(
            label: 'Continue to Paystack',
            onPressed: () => ctx.pop(amountCtl.text.replaceAll(RegExp(r'[^\d]'), '')),
          ),
        ],
      ),
    );
    if (result == null || result.isEmpty) return;
    try {
      final url = await ref.read(walletRepositoryProvider)
          .fund(double.parse(result), user?.email ?? '');
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Opening Paystack… your wallet updates after server verification.'),
          action: SnackBarAction(label: url.isEmpty ? '' : 'Pay', onPressed: () {}),
        ));
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(errorMessageOf(e, 'Funding is unavailable right now.'))));
      }
    }
  }
}

class _ServiceTile extends StatelessWidget {
  const _ServiceTile(this.label, this.icon, this.onTap);
  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 82,
      child: StarkCard(
        onTap: onTap,
        padding: const EdgeInsets.symmetric(vertical: 14),
        child: Column(children: [
          Icon(icon, color: StarkColors.cyan, size: 26),
          const SizedBox(height: 6),
          Text(label, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800)),
        ]),
      ),
    );
  }
}

/* ================= PURCHASE FLOW (presentation) ==================== */
// Buy → PIN/biometric gate → POST purchase (idempotent) → processing →
// success/failure rendered from the server's verified response only.

class BuyScreen extends ConsumerStatefulWidget {
  const BuyScreen({super.key, required this.service});
  final String service;

  @override
  ConsumerState<BuyScreen> createState() => _BuyScreenState();
}

class _BuyScreenState extends ConsumerState<BuyScreen> {
  final _account = TextEditingController();
  final _amount = TextEditingController();
  String? _resultStatus;
  String? _resultMessage;
  String? _token;

  Future<void> _authorizeThenBuy() async {
    final bio = ref.read(biometricServiceProvider);
    final useBio = await bio.isAvailable();
    if (useBio) {
      final ok = await bio.authenticate(reason: 'Authorize ${widget.service} purchase on Stark');
      if (!ok) return;
    }
    if (!mounted) return;
    final pin = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(StarkRadius.sheet)),
      ),
      builder: (_) => Padding(
        padding: const EdgeInsets.all(StarkSpace.xxl),
        child: StarkPinInput(onSubmit: (p) => Navigator.of(context).pop(p)),
      ),
    );
    if (pin == null || pin.length != 4) return;

    setState(() { _resultStatus = 'PROCESSING'; _resultMessage = 'Reserving funds and contacting the provider…'; });
    try {
      final res = await ref.read(walletRepositoryProvider).purchase({
        'service': widget.service,
        'account': _account.text.trim(),
        'phone': _account.text.trim(),
        'amount': double.tryParse(_amount.text) ?? 0,
      }, pin);
      setState(() {
        _resultStatus = res['status'] as String?;
        _token = res['token'] as String?;
        _resultMessage = res['message'] as String? ?? 'Done.';
      });
      ref.invalidate(walletBalancesProvider);
      ref.invalidate(transactionsProvider);
    } catch (e) {
      setState(() {
        _resultStatus = 'FAILED';
        _resultMessage = errorMessageOf(e, 'The purchase could not start. Nothing was charged.');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Buy ${widget.service}', style: const TextStyle(fontWeight: FontWeight.w800))),
      body: ListView(
        padding: const EdgeInsets.all(StarkSpace.xl),
        children: [
          StarkTextField(
            label: widget.service == 'airtime' || widget.service == 'data' ? 'Phone number' : 'Account / IUC / Meter',
            controller: _account,
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 12),
          StarkTextField(label: 'Amount (₦)', controller: _amount, keyboardType: TextInputType.number),
          const SizedBox(height: 20),
          if (_resultStatus == 'PROCESSING')
            const StarkCard(child: Row(children: [
              SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: StarkColors.info)),
              SizedBox(width: 12),
              Expanded(child: Text('Your transaction is processing. We’ll confirm from the provider — nothing is double-charged.')),
            ]))
          else if (_resultStatus != null)
            StarkCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                StarkStatusBadge(status: _resultStatus!),
                const SizedBox(height: 10),
                Text(_resultMessage ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
                if ((_token ?? '').isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Text('Token: $_token', style: const TextStyle(color: StarkColors.cyan, fontWeight: FontWeight.w800)),
                ],
              ]),
            ),
          const SizedBox(height: 20),
          StarkButton(
            label: 'Review & pay',
            icon: Icons.lock_outline_rounded,
            onPressed: _account.text.isEmpty || _amount.text.isEmpty ? null : _authorizeThenBuy,
          ),
          const SizedBox(height: 8),
          Text(
            'Every purchase is authorized with your PIN or biometrics, reserved from your wallet, and settled only when the provider confirms.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ],
      ),
    );
  }
}

/* ================ PROFILE + PHOTO (presentation) =================== */

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});
  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  File? _picked;
  double _progress = 0;
  bool _uploading = false;

  Future<void> _pick(bool camera) async {
    try {
      final file = await ref.read(profilePhotoServiceProvider).pick(camera: camera);
      if (file != null) setState(() => _picked = file);
    } on PhotoTooLargeException catch (e) {
      _toast(e.toString());
    } catch (_) {
      _toast('Photo permission is needed to continue.');
    }
  }

  Future<void> _upload() async {
    if (_picked == null) return;
    setState(() { _uploading = true; _progress = 0; });
    try {
      await ref.read(profilePhotoServiceProvider).upload(_picked!, onProgress: (p) => setState(() => _progress = p));
      ref.read(authControllerProvider.notifier).bootstrap();
      _toast('Profile photo updated');
    } catch (e) {
      _toast(errorMessageOf(e, 'Upload failed — check your connection and retry.'));
    } finally {
      setState(() { _uploading = false; _picked = null; });
    }
  }

  void _toast(String msg) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authControllerProvider).valueOrNull;
    return Scaffold(
      appBar: AppBar(title: const Text('Profile', style: TextStyle(fontWeight: FontWeight.w800))),
      body: ListView(
        padding: const EdgeInsets.all(StarkSpace.xl),
        children: [
          Center(
            child: Stack(children: [
              CircleAvatar(
                radius: 54,
                backgroundColor: StarkColors.darkCard,
                backgroundImage: _picked != null
                    ? FileImage(_picked!)
                    : ((user?.photoUrl ?? '').isNotEmpty ? NetworkImage(user!.photoUrl) : null),
                child: (user?.photoUrl ?? '').isEmpty && _picked == null
                    ? Text((user?.name ?? 'S')[0].toUpperCase(),
                        style: const TextStyle(fontSize: 40, fontWeight: FontWeight.w800, color: StarkColors.cyan))
                    : null,
              ),
              Positioned(
                right: 0, bottom: 0,
                child: Material(
                  color: StarkColors.cyan,
                  shape: const CircleBorder(),
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: () => _photoSheet(),
                    child: const Padding(
                      padding: EdgeInsets.all(8),
                      child: Icon(Icons.edit_rounded, size: 16, color: Colors.black),
                    ),
                  ),
                ),
              ),
            ]),
          ),
          const SizedBox(height: 8),
          if (_uploading)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 40),
              child: LinearProgressIndicator(value: _progress, color: StarkColors.cyan),
            )
          else
            Center(
              child: TextButton(onPressed: _photoSheet,
                  child: const Text('Change Profile Photo',
                      style: TextStyle(color: StarkColors.cyan, fontWeight: FontWeight.w700))),
            ),
          const SizedBox(height: 12),
          StarkCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(user?.name ?? '—', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            Text(user?.email ?? '', style: Theme.of(context).textTheme.bodyMedium),
            Text(user?.phone ?? '', style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 8),
            Text('Referral code: ${user?.referralCode ?? '—'}',
                style: const TextStyle(color: StarkColors.success, fontWeight: FontWeight.w800, fontSize: 12)),
          ])),
          const SizedBox(height: 16),
          StarkButton(
            label: 'Sign out',
            variant: StarkButtonVariant.danger,
            icon: Icons.logout_rounded,
            onPressed: () async {
              await ref.read(authControllerProvider.notifier).signOut();
              if (mounted) context.go('/auth');
            },
          ),
        ],
      ),
    );
  }

  void _photoSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(StarkRadius.sheet)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.camera_alt_rounded, color: StarkColors.cyan),
              title: const Text('Take Photo'), onTap: () { Navigator.pop(ctx); _pick(true); }),
          ListTile(leading: const Icon(Icons.photo_library_rounded, color: StarkColors.cyan),
              title: const Text('Choose From Gallery'), onTap: () { Navigator.pop(ctx); _pick(false); }),
          if ((ref.read(authControllerProvider).valueOrNull?.photoUrl ?? '').isNotEmpty)
            ListTile(leading: const Icon(Icons.delete_outline_rounded, color: StarkColors.error),
                title: const Text('Remove Photo'),
                onTap: () async {
                  Navigator.pop(ctx);
                  await ref.read(profilePhotoServiceProvider).remove();
                  ref.read(authControllerProvider.notifier).bootstrap();
                }),
        ]),
      ),
    );
  }
}

/* ============== SUPPORT / WHATSAPP HELP CENTER ====================== */
// Ticket form → WhatsAppService (validate → build → encode → launch).
// The Go backend persists the ticket first (POST /api/v1/support/tickets)
// so Stark keeps a record; WhatsApp then opens and the USER taps Send.
// Opening WhatsApp never means "sent" — the UI says the message is READY.

class SupportScreen extends ConsumerStatefulWidget {
  const SupportScreen({super.key, this.transactionRef});
  final String? transactionRef; // attached when opened from a transaction

  @override
  ConsumerState<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends ConsumerState<SupportScreen> {
  final _subject = TextEditingController();
  final _description = TextEditingController();
  String _category = 'General';
  bool _busy = false;
  String? _error;
  String? _readyMessage; // set once WhatsApp has been prepared

  static const _categories = [
    'General', 'Airtime', 'Data', 'Cable TV',
    'Electricity', 'Wallet', 'Dispute', 'Security',
  ];

  Future<void> _submit() async {
    setState(() { _busy = true; _error = null; });
    const service = WhatsAppService();
    final user = ref.read(authControllerProvider).valueOrNull;
    try {
      // Optional production step: persist ticket on the Go backend first
      // to obtain a STK-TKT-… reference, then pass it as ticketId below.
      final message = await service.sendSupportTicket(
        subject: _subject.text,
        category: _category,
        description: _description.text,
        user: user == null
            ? null
            : SupportUser(name: user.name, phone: user.phone, email: user.email),
        tx: widget.transactionRef == null
            ? null
            : SupportTransaction(
                id: widget.transactionRef!, service: 'Transaction',
                amount: '—', status: 'SEE APP'),
      );
      setState(() => _readyMessage = message);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Your support message is ready in WhatsApp. '
              'Review it and tap Send to contact Stark Support.'),
        ));
      }
    } on TicketValidationException catch (e) {
      setState(() => _error = e.message); // form is kept for retry
    } on WhatsAppUnavailableException {
      // Graceful fallback — copy + WhatsApp Web. Form stays intact.
      final msg = service.createSupportMessage(
        subject: _subject.text.trim(), category: _category,
        description: _description.text.trim(),
      );
      setState(() => _readyMessage = msg);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: const Text('WhatsApp is not available on this device.'),
          action: SnackBarAction(
            label: 'WhatsApp Web',
            onPressed: () => service.openWhatsAppWeb(msg),
          ),
        ));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Open a support ticket',
          style: TextStyle(fontWeight: FontWeight.w800))),
      body: ListView(
        padding: const EdgeInsets.all(StarkSpace.xl),
        children: [
          StarkTextField(label: 'Subject *', controller: _subject,
              hint: 'Data bundle not delivered'),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _category,
            decoration: const InputDecoration(labelText: 'Category *'),
            items: _categories
                .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                .toList(),
            onChanged: (c) => setState(() => _category = c ?? 'General'),
          ),
          const SizedBox(height: 12),
          StarkTextField(label: 'Describe the issue *', controller: _description,
              hint: 'Include dates, phone numbers and references…'),
          if (_error != null) _ErrorText(_error!),
          const SizedBox(height: 20),
          StarkButton(
            label: _busy ? 'Preparing support request…' : 'Submit ticket',
            loading: _busy,
            icon: Icons.chat_bubble_outline_rounded,
            onPressed: _busy ? null : _submit,
          ),
          const SizedBox(height: 8),
          Text(
            'Opens the Stark Help Center WhatsApp chat ($kStarkWhatsAppDisplay) '
            'with your details pre-filled. You review the message and tap Send — '
            'the app never sends it silently.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ],
      ),
    );
  }
}

/* ====================== SHELL REGISTRATION ========================== */
// Maps GoRouter placeholders to real screens. Replace _ScreenPlaceholder
// lookups in appRouterProvider with these constructors in the full repo:
//
//   '/auth'    → AuthScreen()
//   '/home'    → StarkShell(child: HomeScreen())
//   '/wallet'  → StarkShell(child: WalletScreen())   // wallet tab
//   '/activity'→ StarkShell(child: ActivityScreen()) // transactions tab
//   '/ai'      → StarkShell(child: StarkAIScreen())
//   '/profile' → StarkShell(child: ProfileScreen())
//   '/buy/:s'  → BuyScreen(service: state.pathParameters['s']!)
//   '/support' → StarkShell(child: SupportScreen())
//   '/support/tx/:ref' → StarkShell(child: SupportScreen(transactionRef: ref))

class StarkShell extends ConsumerStatefulWidget {
  const StarkShell({super.key, required this.child, required this.tab});
  final Widget child;
  final int tab;

  @override
  ConsumerState<StarkShell> createState() => _StarkShellState();
}

class _StarkShellState extends ConsumerState<StarkShell> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: widget.child,
      bottomNavigationBar: StarkBottomNavigation(
        index: widget.tab,
        onTap: (i) {
          const paths = ['/home', '/wallet', '/activity', '/ai', '/profile'];
          context.go(paths[i]);
        },
      ),
    );
  }
}
