// STARK local cache — Drift + SQLite.
//
// Caches ONLY safe information for offline mode:
//   profile snapshot · beneficiaries · recent transactions · receipts
//
// HARD RULE: wallet balances are NEVER stored here. A cached balance is
// not live truth — financial screens always read from the Go ledger,
// and financial actions require backend connectivity. Offline mode is
// surfaced explicitly in the UI ("OFFLINE MODE" banner).
//
// Generate with:  dart run build_runner build --delete-conflicting-outputs
import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

part 'app_database.g.dart';

class ProfileCache extends Table {
  TextColumn get userId => text()();
  TextColumn get fullName => text()();
  TextColumn get email => text()();
  TextColumn get phone => text()();
  TextColumn get referralCode => text()();
  TextColumn get photoUrl => text().withDefault(const Constant(''))();
  BoolColumn get pinSet => boolean().withDefault(const Constant(false))();
  BoolColumn get twoFactor => boolean().withDefault(const Constant(false))();
  IntColumn get cachedAt => integer()(); // epoch millis — freshness marker
  @override
  Set<Column> get primaryKey => {userId};
}

class Beneficiaries extends Table {
  TextColumn get id => text()();
  TextColumn get kind => text()(); // phone | meter | cable
  TextColumn get network => text().withDefault(const Constant(''))();
  TextColumn get identifier => text()();
  TextColumn get label => text().withDefault(const Constant(''))();
  BoolColumn get favorite => boolean().withDefault(const Constant(false))();
  @override
  Set<Column> get primaryKey => {id};
}

class RecentTransactions extends Table {
  TextColumn get id => text()();
  TextColumn get ref => text()();
  TextColumn get service => text()();
  TextColumn get network => text().withDefault(const Constant(''))();
  TextColumn get account => text().withDefault(const Constant(''))();
  IntColumn get totalKobo => integer()();
  TextColumn get status => text()();
  IntColumn get createdAt => integer()(); // epoch millis
  @override
  Set<Column> get primaryKey => {id};
}

class Receipts extends Table {
  TextColumn get txId => text()();
  TextColumn get receiptJson => text()(); // full receipt payload for offline viewing
  IntColumn get cachedAt => integer()();
  @override
  Set<Column> get primaryKey => {txId};
}

@DriftDatabase(tables: [ProfileCache, Beneficiaries, RecentTransactions, Receipts])
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_openConnection());

  AppDatabase.forTesting(super.executor);

  @override
  int get schemaVersion => 1;

  /* ------------------------- profile ------------------------- */

  Future<void> cacheProfile(ProfileCacheCompanion row) =>
      into(profileCache).insertOnConflictUpdate(row);

  Stream<ProfileCacheData?> watchProfile() =>
      (select(profileCache)..orderBy([(t) => OrderingTerm.desc(t.cachedAt)])).watchSingleOrNull();

  /* ---------------------- beneficiaries ---------------------- */

  Future<void> replaceBeneficiaries(List<BeneficiariesCompanion> rows) => batch((b) {
        b.deleteAll(beneficiaries);
        b.insertAll(beneficiaries, rows);
      });

  Stream<List<BeneficiariesData>> watchBeneficiaries() =>
      (select(beneficiaries)..orderBy([(t) => OrderingTerm.desc(t.favorite)])).watch();

  /* ------------------- recent transactions ------------------- */

  Future<void> replaceRecent(List<RecentTransactionsCompanion> rows) => batch((b) {
        b.deleteAll(recentTransactions);
        b.insertAll(recentTransactions, rows);
      });

  Stream<List<RecentTransactionsData>> watchRecent({int limit = 20}) =>
      (select(recentTransactions)
            ..orderBy([(t) => OrderingTerm.desc(t.createdAt)])
            ..limit(limit))
          .watch();

  /* ------------------------- receipts ------------------------- */

  Future<void> cacheReceipt(String txId, String receiptJson) =>
      into(receipts).insertOnConflictUpdate(
        ReceiptsCompanion.insert(txId: txId, receiptJson: receiptJson, cachedAt: DateTime.now().millisecondsSinceEpoch),
      );

  Future<ReceiptsData?> receiptFor(String txId) =>
      (select(receipts)..where((t) => t.txId.equals(txId))).getSingleOrNull();

  /* ------------------------ maintenance ----------------------- */

  Future<void> clearAll() => batch((b) {
        b.deleteAll(profileCache);
        b.deleteAll(beneficiaries);
        b.deleteAll(recentTransactions);
        b.deleteAll(receipts);
      });
}

LazyDatabase _openConnection() {
  return LazyDatabase(() async {
    final dir = await getApplicationDocumentsDirectory();
    final file = File(p.join(dir.path, 'stark_cache.sqlite'));
    return NativeDatabase.createInBackground(file);
  });
}
