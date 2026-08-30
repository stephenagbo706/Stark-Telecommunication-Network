// STARK shared components — the reusable kit every feature screen is
// built from. Consistent radii, spacing and haptics across the app.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/core.dart';

void hapticLight() => HapticFeedback.lightImpact();
void hapticSuccess() => HapticFeedback.mediumImpact();

/* ---------------------------- buttons ----------------------------- */

class StarkButton extends StatefulWidget {
  const StarkButton({
    super.key,
    required this.label,
    this.icon,
    this.onPressed,
    this.loading = false,
    this.variant = StarkButtonVariant.primary,
  });

  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool loading;
  final StarkButtonVariant variant;

  @override
  State<StarkButton> createState() => _StarkButtonState();
}

enum StarkButtonVariant { primary, outline, danger, ghost }

class _StarkButtonState extends State<StarkButton> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null && !widget.loading;
    Color bg, fg, border;
    switch (widget.variant) {
      case StarkButtonVariant.primary:
        bg = StarkColors.cyan; fg = Colors.black; border = Colors.transparent;
        break;
      case StarkButtonVariant.outline:
        bg = Colors.transparent; fg = StarkColors.cyan; border = StarkColors.cyan.withOpacity(0.45);
        break;
      case StarkButtonVariant.danger:
        bg = StarkColors.error.withOpacity(0.12); fg = StarkColors.error; border = StarkColors.error.withOpacity(0.4);
        break;
      case StarkButtonVariant.ghost:
        bg = Colors.white.withOpacity(0.04); fg = StarkColors.darkText; border = Colors.white.withOpacity(0.1);
        break;
    }
    return AnimatedScale(
      scale: _down ? 0.97 : 1,
      duration: const Duration(milliseconds: 90),
      child: SizedBox(
        width: double.infinity,
        height: 52,
        child: Material(
          color: enabled ? bg : bg.withOpacity(0.35),
          borderRadius: BorderRadius.circular(StarkRadius.input),
          child: InkWell(
            borderRadius: BorderRadius.circular(StarkRadius.input),
            onTapDown: (_) => setState(() => _down = true),
            onTapUp: (_) => setState(() => _down = false),
            onTapCancel: () => setState(() => _down = false),
            onTap: enabled
                ? () {
                    hapticLight();
                    widget.onPressed!();
                  }
                : null,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(StarkRadius.input),
                border: Border.all(color: border),
              ),
              child: Center(
                child: widget.loading
                    ? SizedBox(
                        width: 20, height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2.5, color: fg),
                      )
                    : Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (widget.icon != null) ...[
                            Icon(widget.icon, size: 18, color: fg),
                            const SizedBox(width: 8),
                          ],
                          Text(widget.label,
                              style: TextStyle(color: fg, fontWeight: FontWeight.w700, fontSize: 14)),
                        ],
                      ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/* ----------------------------- cards ------------------------------ */

class StarkCard extends StatelessWidget {
  const StarkCard({super.key, required this.child, this.onTap, this.padding});
  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsets? padding;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).cardColor,
      borderRadius: BorderRadius.circular(StarkRadius.card),
      child: InkWell(
        borderRadius: BorderRadius.circular(StarkRadius.card),
        onTap: onTap,
        child: Padding(
          padding: padding ?? const EdgeInsets.all(StarkSpace.lg),
          child: child,
        ),
      ),
    );
  }
}

/// Gradient wallet card with balance + quick actions.
class StarkWalletCard extends StatelessWidget {
  const StarkWalletCard({
    super.key,
    required this.balanceKobo,
    required this.reservedKobo,
    required this.onAddMoney,
    this.hidden = false,
  });

  final int balanceKobo;
  final int reservedKobo;
  final VoidCallback onAddMoney;
  final bool hidden;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(StarkSpace.xl),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(StarkRadius.largeCard),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF0A1A2E), Color(0xFF0F2440), Color(0xFF0A1A2E)],
        ),
        border: Border.all(color: StarkColors.cyan.withOpacity(0.25)),
        boxShadow: [
          BoxShadow(color: StarkColors.cyan.withOpacity(0.18), blurRadius: 36, offset: const Offset(0, 18)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('AVAILABLE BALANCE',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(color: StarkColors.secondaryText)),
          const SizedBox(height: 6),
          Text(hidden ? '₦ ••••••' : starkNaira(balanceKobo),
              style: Theme.of(context).textTheme.displayLarge?.copyWith(fontSize: 32)),
          if (reservedKobo > 0) ...[
            const SizedBox(height: 8),
            Text('${starkNaira(reservedKobo)} processing',
                style: const TextStyle(color: StarkColors.info, fontSize: 11, fontWeight: FontWeight.w700)),
          ],
          const SizedBox(height: 18),
          StarkButton(label: '+ Add Money', onPressed: onAddMoney),
        ],
      ),
    );
  }
}

/* ----------------------------- inputs ----------------------------- */

class StarkTextField extends StatelessWidget {
  const StarkTextField({
    super.key,
    required this.label,
    this.controller,
    this.hint,
    this.prefix,
    this.keyboardType,
    this.obscure = false,
    this.errorText,
    this.onChanged,
  });

  final String label;
  final TextEditingController? controller;
  final String? hint;
  final Widget? prefix;
  final TextInputType? keyboardType;
  final bool obscure;
  final String? errorText;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 6),
        TextField(
          controller: controller,
          obscureText: obscure,
          keyboardType: keyboardType,
          onChanged: onChanged,
          style: const TextStyle(fontWeight: FontWeight.w600),
          decoration: InputDecoration(
            hintText: hint,
            prefixIcon: prefix,
            errorText: errorText,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(StarkRadius.input)),
          ),
        ),
      ],
    );
  }
}

/// 4-digit transaction PIN pad with masked dots.
class StarkPinInput extends StatefulWidget {
  const StarkPinInput({super.key, required this.onSubmit, this.title = 'Enter your transaction PIN'});
  final ValueChanged<String> onSubmit;
  final String title;

  @override
  State<StarkPinInput> createState() => _StarkPinInputState();
}

class _StarkPinInputState extends State<StarkPinInput> {
  String _pin = '';

  void _tap(String d) {
    hapticLight();
    setState(() {
      if (d == 'del') {
        _pin = _pin.isEmpty ? _pin : _pin.substring(0, _pin.length - 1);
      } else if (_pin.length < 4) {
        _pin += d;
        if (_pin.length == 4) widget.onSubmit(_pin);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(widget.title, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(4, (i) {
            final filled = i < _pin.length;
            return AnimatedContainer(
              duration: const Duration(milliseconds: 120),
              margin: const EdgeInsets.symmetric(horizontal: 8),
              width: filled ? 16 : 13,
              height: filled ? 16 : 13,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: filled ? StarkColors.cyan : Colors.transparent,
                border: Border.all(color: StarkColors.cyan.withOpacity(0.5), width: 1.5),
              ),
            );
          }),
        ),
        const SizedBox(height: 24),
        ...['123', '456', '789'].map((row) => Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: row.split('').map((d) => _key(d)).toList(),
            )),
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          _key(''), _key('0'), _key('del'),
        ]),
      ],
    );
  }

  Widget _key(String d) => SizedBox(
        width: 76,
        height: 60,
        child: d.isEmpty
            ? const SizedBox.shrink()
            : TextButton(
                onPressed: () => _tap(d),
                child: Text(
                  d == 'del' ? '⌫' : d,
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: StarkColors.darkText),
                ),
              ),
      );
}

/* --------------------------- status bits -------------------------- */

class StarkStatusBadge extends StatelessWidget {
  const StarkStatusBadge({super.key, required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final (color, label) = switch (status.toUpperCase()) {
      'SUCCESSFUL' => (StarkColors.success, 'Successful'),
      'PENDING' => (StarkColors.warning, 'Pending'),
      'PROCESSING' => (StarkColors.info, 'Processing'),
      'FAILED' => (StarkColors.error, 'Failed'),
      'REVERSED' || 'REFUNDED' => (StarkColors.warning, status.toLowerCase()),
      _ => (StarkColors.secondaryText, status),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.35)),
      ),
      child: Text(label, style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w800)),
    );
  }
}

class StarkSkeleton extends StatefulWidget {
  const StarkSkeleton({super.key, this.height = 84});
  final double height;

  @override
  State<StarkSkeleton> createState() => _StarkSkeletonState();
}

class _StarkSkeletonState extends State<StarkSkeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
        opacity: Tween<double>(begin: 0.35, end: 0.9).animate(_c),
        child: Container(
          height: widget.height,
          decoration: BoxDecoration(
            color: Theme.of(context).cardColor,
            borderRadius: BorderRadius.circular(StarkRadius.card),
          ),
        ),
      );
}

class StarkEmptyState extends StatelessWidget {
  const StarkEmptyState({super.key, required this.icon, required this.title, this.subtitle, this.actionLabel, this.onAction});
  final IconData icon;
  final String title;
  final String? subtitle;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 44, color: StarkColors.secondaryText.withOpacity(0.5)),
          const SizedBox(height: 12),
          Text(title, style: Theme.of(context).textTheme.titleLarge),
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(subtitle!, style: Theme.of(context).textTheme.bodyMedium, textAlign: TextAlign.center),
          ],
          if (actionLabel != null) ...[
            const SizedBox(height: 16),
            SizedBox(
              width: 220,
              child: StarkButton(label: actionLabel!, onPressed: onAction, variant: StarkButtonVariant.outline),
            ),
          ],
        ],
      ),
    );
  }
}

/* ------------------------- bottom navigation ---------------------- */

class StarkBottomNavigation extends StatelessWidget {
  const StarkBottomNavigation({super.key, required this.index, required this.onTap});
  final int index;
  final ValueChanged<int> onTap;

  static const items = [
    (Icons.home_rounded, 'Home'),
    (Icons.account_balance_wallet_rounded, 'Wallet'),
    (Icons.receipt_long_rounded, 'Activity'),
    (Icons.auto_awesome_rounded, 'Stark AI'),
    (Icons.person_rounded, 'Profile'),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border(top: BorderSide(color: Colors.white.withOpacity(0.06))),
      ),
      child: SafeArea(
        child: SizedBox(
          height: 64,
          child: Row(
            children: List.generate(items.length, (i) {
              final active = i == index;
              return Expanded(
                child: InkWell(
                  onTap: () {
                    hapticLight();
                    onTap(i);
                  },
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 160),
                    margin: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: active ? StarkColors.cyan.withOpacity(0.1) : Colors.transparent,
                      borderRadius: BorderRadius.circular(StarkRadius.control),
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(items[i].$1, size: 22, color: active ? StarkColors.cyan : StarkColors.secondaryText),
                        const SizedBox(height: 3),
                        Text(items[i].$2,
                            style: TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.w800,
                              color: active ? StarkColors.cyan : StarkColors.secondaryText,
                            )),
                      ],
                    ),
                  ),
                ),
              );
            }),
          ),
        ),
      ),
    );
  }
}
