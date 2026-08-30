// STARK feature: referrals (§1–§45).
//
// Clean-architecture slice, consolidated for delivery; in the repo it
// lives under features/referrals/{data,domain,presentation}.
//
// The screen renders ONLY server-computed statistics (§21). Copying the
// link is local (§5); sharing uses the native sheet (§6); earnings are
// moved to the wallet exclusively through POST /referrals/withdraw (§28).
// Qualification and reward creation never happen on the device (§16).
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/core.dart';
import '../../shared/widgets.dart';

/* ============================ domain =============================== */

class ReferralStats {
  ReferralStats.fromJson(Map<String, dynamic> j)
      : code = j['referral_code'] ?? '',
        link = j['referral_link'] ?? '',
        invited = (j['invited'] as num?)?.toInt() ?? 0,
        active = (j['active'] as num?)?.toInt() ?? 0,
        earnedKobo = (j['earned_kobo'] as num?)?.toInt() ?? 0,
        pendingKobo = (j['pending_kobo'] as num?)?.toInt() ?? 0,
        availableKobo = (j['available_kobo'] as num?)?.toInt() ?? 0;

  final String code, link;
  final int invited, active, earnedKobo, pendingKobo, availableKobo;
}

class ReferralRecord {
  ReferralRecord.fromJson(Map<String, dynamic> j)
      : id = j['id'] ?? '',
        name = j['referred_name'] ?? '',
        status = j['status'] ?? 'REGISTERED',
        rewardKobo = (j['reward_kobo'] as num?)?.toInt() ?? 0,
        rewardStatus = j['reward_status'] ?? '',
        createdAt = DateTime.tryParse(j['created_at']?.toString() ?? '') ?? DateTime.now();

  final String id, name, status, rewardStatus;
  final int rewardKobo;
  final DateTime createdAt;
}

/* ============================== data =============================== */

class ReferralRepository {
  ReferralRepository(this._api);
  final ApiClient _api;

  Future<ReferralStats> stats() async {
    final res = await _api.dio.get('/api/v1/referrals/me');
    return ReferralStats.fromJson(dataOf(res));
  }

  Future<List<ReferralRecord>> history() async {
    final res = await _api.dio.get('/api/v1/referrals/history');
    final list = dataOf(res)['referrals'] as List<dynamic>? ?? [];
    return list.map((e) => ReferralRecord.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> withdraw() => _api.dio.post('/api/v1/referrals/withdraw',  {});
}

final referralRepositoryProvider =
    Provider((ref) => ReferralRepository(ref.watch(apiClientProvider)));

/* ========================= presentation ============================ */

class ReferralState {
  const ReferralState({this.stats, this.history = const [], this.loading = false, this.error});
  final ReferralStats? stats;
  final List<ReferralRecord> history;
  final bool loading;
  final String? error;

  ReferralState copyWith({ReferralStats? stats, List<ReferralRecord>? history,
      bool? loading, String? error}) =>
      ReferralState(
        stats: stats ?? this.stats,
        history: history ?? this.history,
        loading: loading ?? this.loading,
        error: error,
      );
}

class ReferralController extends StateNotifier<ReferralState> {
  ReferralController(this._repo) : super(const ReferralState(loading: true)) {
    load();
  }
  final ReferralRepository _repo;

  Future<void> load() async {
    state = state.copyWith(loading: true, error: null);
    try {
      final results = await Future.wait([_repo.stats(), _repo.history()]);
      state = ReferralState(stats: results[0] as ReferralStats, history: results[1] as List<ReferralRecord>);
    } catch (e) {
      state = state.copyWith(loading: false, error: errorMessageOf(e, 'Unable to load referral information.'));
    }
  }

  Future<String?> withdraw() async {
    try {
      await _repo.withdraw();
      await load();
      return null; // success
    } catch (e) {
      return errorMessageOf(e, 'The transfer could not be completed. Please retry.');
    }
  }
}

final referralControllerProvider =
    StateNotifierProvider<ReferralController, ReferralState>((ref) {
  return ReferralController(ref.watch(referralRepositoryProvider));
});

/* ============================== screen ============================= */
// Mirrors the existing Stark Referrals UI: code card, COPY LINK, share,
// 4-stat grid, history list and "how it works". No redesign (§45).

class ReferralScreen extends ConsumerWidget {
  const ReferralScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final st = ref.watch(referralControllerProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Referrals', style: TextStyle(fontWeight: FontWeight.w800))),
      body: RefreshIndicator(
        color: StarkColors.cyan,
        onRefresh: () => ref.read(referralControllerProvider.notifier).load(),
        child: st.loading
            ? const Center(child: StarkSkeleton(height: 300))
            : st.error != null
                ? StarkEmptyState(
                    icon: Icons.error_outline_rounded,
                    title: 'Unable to load referral information.',
                    subtitle: st.error!,
                    actionLabel: 'Retry',
                    onAction: () => ref.read(referralControllerProvider.notifier).load(),
                  )
                : _content(context, ref, st),
      ),
    );
  }

  Widget _content(BuildContext context, WidgetRef ref, ReferralState st) {
    final s = st.stats!;
    return ListView(
      padding: const EdgeInsets.all(StarkSpace.xl),
      children: [
        StarkCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('YOUR CODE', style: TextStyle(color: StarkColors.success,
                fontSize: 10, fontWeight: FontWeight.w800, letterSpacing: 2)),
            const SizedBox(height: 6),
            Row(children: [
              Expanded(child: Text(s.code,
                  style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800))),
              IconButton(
                icon: const Icon(Icons.copy_rounded, color: StarkColors.cyan),
                onPressed: () => _copy(context, s.code, 'Referral code copied!'),
              ),
            ]),
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: StarkColors.darkCard, borderRadius: BorderRadius.circular(StarkRadius.control),
                border: Border.all(color: StarkColors.cyan.withOpacity(0.25)),
              ),
              child: Text(s.link, style: const TextStyle(fontSize: 11, fontFamily: 'monospace')),
            ),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: StarkButton(label: 'COPY LINK', icon: Icons.link_rounded,
                  onPressed: () => _copy(context, s.link, 'Referral link copied!'))),
              const SizedBox(width: 8),
              Expanded(child: StarkButton(label: 'SHARE', icon: Icons.share_rounded,
                  variant: StarkButtonVariant.ghost,
                  onPressed: () => Share.share(
                      'Join me on Stark Telecommunication.\n\nUse my referral link:\n${s.link}'))),
            ]),
            const SizedBox(height: 16),
            Row(children: [
              _stat('${s.invited}', 'INVITED'), _stat('${s.active}', 'ACTIVE'),
              _stat(starkNaira(s.earnedKobo), 'EARNED'), _stat(starkNaira(s.pendingKobo), 'PENDING'),
            ]),
            const SizedBox(height: 12),
            StarkButton(
              label: 'Transfer ${starkNaira(s.availableKobo)} to wallet',
              icon: Icons.account_balance_wallet_rounded,
              onPressed: s.availableKobo < 50000 ? null : () async {
                final err = await ref.read(referralControllerProvider.notifier).withdraw();
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                    content: Text(err ?? 'Referral earnings moved to your Stark wallet.'),
                  ));
                }
              },
            ),
          ]),
        ),
        const SizedBox(height: 16),
        Text('Your referrals', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        if (st.history.isEmpty)
          StarkEmptyState(icon: Icons.group_add_rounded, title: 'No referrals yet',
              subtitle: 'Share your link — you earn ₦500 for every friend who makes a first purchase.')
        else
          ...st.history.map((r) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: StarkCard(
                  child: Row(children: [
                    CircleAvatar(backgroundColor: StarkColors.darkCard,
                        child: Text(r.name.isNotEmpty ? r.name[0].toUpperCase() : '?',
                            style: const TextStyle(color: StarkColors.cyan, fontWeight: FontWeight.w800))),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(r.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                        Text(_label(r.status), style: Theme.of(context).textTheme.bodyMedium),
                      ]),
                    ),
                    Text(r.rewardKobo > 0 ? '+${starkNaira(r.rewardKobo)}' : '—',
                        style: TextStyle(fontWeight: FontWeight.w800,
                            color: r.rewardKobo > 0 ? StarkColors.success : StarkColors.secondaryText)),
                  ]),
                ),
              )),
      ],
    );
  }

  Widget _stat(String value, String label) => Expanded(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 3),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(color: StarkColors.darkCard,
                borderRadius: BorderRadius.circular(StarkRadius.control)),
            child: Column(children: [
              Text(value, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              const SizedBox(height: 2),
              Text(label, style: const TextStyle(fontSize: 8, fontWeight: FontWeight.w800,
                  letterSpacing: 1.5, color: StarkColors.secondaryText)),
            ]),
          ),
        ),
      );

  String _label(String status) => const {
        'REGISTERED': 'Registered', 'VERIFIED': 'Verified', 'FUNDED': 'Funded',
        'ACTIVE': 'Active', 'REWARDED': 'Rewarded', 'PENDING_REVIEW': 'Pending review',
        'REJECTED': 'Rejected', 'EXPIRED': 'Expired',
      }[status] ?? status;

  Future<void> _copy(BuildContext context, String text, String msg) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }
}
