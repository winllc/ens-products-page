package com.enssolutions.license;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * What every database must do for {@link JdbcLicenseStore}, run against each one by a subclass
 * that creates the tables from the DDL shipped in the jar.
 */
abstract class JdbcLicenseStoreContract {
    static final Clock CLOCK = Clock.fixed(Instant.parse("2026-11-01T00:00:00Z"), ZoneOffset.UTC);

    @TempDir Path dir;

    abstract DataSource dataSource();

    @BeforeEach
    void emptyTables() throws Exception {
        TestLicenses.clear(dataSource());
    }

    JdbcLicenseStore store(Duration recheck) {
        return new JdbcLicenseStore(dataSource(), "certalert", recheck);
    }

    LicenseManager manager(JdbcLicenseStore store) throws Exception {
        return new LicenseManager("certalert", TestLicenses.verifier(), store, Optional.empty(), CLOCK, Optional.empty());
    }

    /** Runs the task on many threads at once and returns what each returned. */
    static <T> List<T> concurrently(int threads, Callable<T> task) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            CountDownLatch go = new CountDownLatch(1);
            List<Future<T>> futures = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                futures.add(pool.submit(() -> {
                    go.await();
                    return task.call();
                }));
            }
            go.countDown();
            List<T> results = new ArrayList<>();
            for (Future<T> f : futures) results.add(f.get(60, TimeUnit.SECONDS));
            return results;
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void storesAndReadsTheLicense() throws Exception {
        JdbcLicenseStore store = store(Duration.ZERO);
        assertTrue(store.licenseVersion().isEmpty());
        assertTrue(store.readLicense().isEmpty());

        // Non-ASCII in the summary lines, and close to the 64 KiB cap.
        String text = "# Licensee: José Núñez\n" + "#".repeat(LicenseVerifier.MAX_FILE_CHARS - 100) + "\n";
        store.writeLicense(text);
        Object v1 = store.licenseVersion().orElseThrow();
        assertEquals(text, store.readLicense().orElseThrow().text());
        assertEquals(v1, store.readLicense().orElseThrow().version());

        store.writeLicense("second");
        assertNotEquals(v1, store.licenseVersion().orElseThrow());
        assertEquals("second", store.readLicense().orElseThrow().text());

        assertThrows(java.io.IOException.class, () -> store.writeLicense("x".repeat(LicenseVerifier.MAX_FILE_CHARS + 1)));
        assertEquals("second", store.readLicense().orElseThrow().text());
    }

    @Test
    void productsAreKeptApart() throws Exception {
        JdbcLicenseStore certalert = store(Duration.ZERO);
        JdbcLicenseStore readyroom = new JdbcLicenseStore(dataSource(), "readyroom", Duration.ZERO);
        certalert.installationId("CA-AAAA-AAAA");
        certalert.writeLicense("a");
        certalert.raiseRevision("lic_a", 4);
        assertEquals("RR-BBBB-BBBB", readyroom.installationId("RR-BBBB-BBBB"));
        assertTrue(readyroom.readLicense().isEmpty());
        assertEquals(0, readyroom.highestRevision("lic_a"));
    }

    @Test
    void concurrentReplicasGetOneInstallationId() throws Exception {
        List<String> ids = concurrently(16, () -> {
            JdbcLicenseStore own = store(Duration.ZERO);           // a replica of its own
            return own.installationId(InstallationId.generate("certalert"));
        });
        assertEquals(1, new HashSet<>(ids).size(), ids.toString());
        assertEquals(ids.get(0), store(Duration.ZERO).storedInstallationId().orElseThrow());
    }

    @Test
    void revisionsAreRaisedAndNeverLowered() throws Exception {
        JdbcLicenseStore store = store(Duration.ZERO);
        assertEquals(0, store.highestRevision("lic_a"));
        assertEquals(3, store.raiseRevision("lic_a", 3));
        assertEquals(3, store.raiseRevision("lic_a", 2));
        assertEquals(3, store.raiseRevision("lic_a", 3));
        assertEquals(9, store.raiseRevision("lic_a", 9));
        assertEquals(9, store.highestRevision("lic_a"));
        assertEquals(0, store.highestRevision("lic_b"));
    }

    @Test
    void concurrentRaisesEndAtTheHighestAndNeverGoBack() throws Exception {
        List<Integer> revisions = new ArrayList<>();
        for (int r = 1; r <= 40; r++) revisions.add(r);
        Collections.shuffle(revisions);
        List<Integer> queue = Collections.synchronizedList(new ArrayList<>(revisions));

        AtomicBoolean done = new AtomicBoolean();
        List<String> wentBack = Collections.synchronizedList(new ArrayList<>());
        Thread watcher = new Thread(() -> {
            JdbcLicenseStore reader = store(Duration.ZERO);
            int last = 0;
            while (!done.get()) {
                try {
                    int now = reader.highestRevision("lic_race");
                    if (now < last) wentBack.add(last + " -> " + now);
                    last = now;
                } catch (Exception e) {
                    wentBack.add(e.toString());
                }
            }
        });
        watcher.start();
        concurrently(8, () -> {
            JdbcLicenseStore own = store(Duration.ZERO);
            int lastSeen = 0;
            while (true) {
                Integer r;
                synchronized (queue) {
                    if (queue.isEmpty()) return lastSeen;
                    r = queue.remove(0);
                }
                int now = own.raiseRevision("lic_race", r);
                assertTrue(now >= r && now >= lastSeen, "raise to " + r + " returned " + now + " after " + lastSeen);
                lastSeen = now;
            }
        });
        done.set(true);
        watcher.join();
        assertEquals(List.of(), wentBack);
        assertEquals(40, store(Duration.ZERO).highestRevision("lic_race"));
    }

    @Test
    void twoManagersShareOneInstallation() throws Exception {
        LicenseManager a = manager(store(Duration.ZERO));
        LicenseManager b = manager(store(Duration.ZERO));
        assertEquals(a.installationId(), b.installationId());
        assertNull(a.licenseFile());
        assertEquals("the database (ens_license_file)", a.licenseLocation());

        // Bound to the shared id: valid on both.
        assertEquals(LicenseState.VALID, a.install(TestLicenses.license("lic_ha", 3, a.installationId())).state());
        assertEquals(LicenseState.VALID, b.current().state());
        assertEquals(3, b.current().license().orElseThrow().revision());

        // b can't put back an older revision a accepted.
        assertEquals(LicenseState.SUPERSEDED, b.install(TestLicenses.license("lic_ha", 2, null)).state());
        assertEquals(3, a.current().license().orElseThrow().revision());

        // A newer one on b is in force on a; the shared history means a never accepts 3 again.
        assertEquals(LicenseState.VALID, b.install(TestLicenses.license("lic_ha", 5, null)).state());
        assertEquals(5, a.current().license().orElseThrow().revision());
        assertEquals(5, store(Duration.ZERO).highestRevision("lic_ha"));
        assertEquals(LicenseState.SUPERSEDED, a.install(TestLicenses.license("lic_ha", 3, null)).state());
    }

    @Test
    void aChangeOnAnotherReplicaShowsWithinTheRecheckInterval() throws Exception {
        LicenseManager a = manager(store(Duration.ZERO));
        LicenseManager b = manager(store(Duration.ofMillis(300)));
        assertEquals(LicenseState.MISSING, b.current().state());
        a.install(TestLicenses.license("lic_poll", 1, null));
        // b may still answer from what it read (no query per request) ...
        long start = System.nanoTime();
        LicenseState seen = b.current().state();
        while (seen != LicenseState.VALID && System.nanoTime() - start < Duration.ofSeconds(5).toNanos()) {
            Thread.sleep(50);
            seen = b.current().state();
        }
        // ... but not for longer than its interval.
        assertEquals(LicenseState.VALID, seen);
        assertTrue(System.nanoTime() - start < Duration.ofSeconds(3).toNanos());
    }

    @Test
    void concurrentManagersComeUpWithOneId() throws Exception {
        List<String> ids = concurrently(8, () -> manager(store(Duration.ZERO)).installationId());
        assertEquals(1, new HashSet<>(ids).size(), ids.toString());
    }

    /* ---- Import from a file state directory --------------------------------- */

    @Test
    void importsAnExistingInstallation() throws Exception {
        // An installation as 1.1.0 ran it: id, a bound license at revision 3, another license's history.
        LicenseManager files = new LicenseManager("certalert", TestLicenses.verifier(), dir.resolve("certalert.lic"),
                dir.resolve("state"), Optional.empty(), CLOCK);
        String id = files.installationId();
        assertEquals(LicenseState.VALID, files.install(TestLicenses.license("lic_bound", 3, id)).state());
        new FileLicenseStore(dir.resolve("certalert.lic"), dir.resolve("state")).raiseRevision("lic_old", 8);

        JdbcLicenseStore store = store(Duration.ZERO);
        assertTrue(store.importFileState(dir.resolve("certalert.lic"), dir.resolve("state")));

        LicenseManager db = manager(store);
        assertEquals(id, db.installationId());
        assertEquals(LicenseState.VALID, db.current().state());        // still bound to the same id
        assertEquals(3, store.highestRevision("lic_bound"));
        assertEquals(8, store.highestRevision("lic_old"));
        assertEquals(LicenseState.SUPERSEDED, db.install(TestLicenses.license("lic_bound", 2, id)).state());

        // Once only: a second replica, or the next start, changes nothing.
        db.install(TestLicenses.license("lic_bound", 4, id));
        assertFalse(store(Duration.ZERO).importFileState(dir.resolve("certalert.lic"), dir.resolve("state")));
        assertEquals(4, manager(store(Duration.ZERO)).current().license().orElseThrow().revision());
    }

    @Test
    void importLeavesAnExistingDatabaseAlone() throws Exception {
        JdbcLicenseStore store = store(Duration.ZERO);
        store.installationId("CA-DBDB-DBDB");
        Files.createDirectories(dir.resolve("state"));
        Files.writeString(dir.resolve("state/installation-id"), "CA-FILE-FILE\n");
        Files.writeString(dir.resolve("state/revisions.properties"), "lic_x=5\n");
        assertFalse(store.importFileState(dir.resolve("certalert.lic"), dir.resolve("state")));
        assertEquals("CA-DBDB-DBDB", store.storedInstallationId().orElseThrow());
        assertEquals(0, store.highestRevision("lic_x"));
    }

    @Test
    void importWithNothingToImportLeavesTheDatabaseEmpty() throws Exception {
        JdbcLicenseStore store = store(Duration.ZERO);
        assertFalse(store.importFileState(dir.resolve("none.lic"), dir.resolve("none")));
        assertTrue(store.storedInstallationId().isEmpty());
        assertTrue(store.licenseVersion().isEmpty());
        // A new installation then gets a new id as usual.
        assertTrue(manager(store).installationId().startsWith("CA-"));
    }

    @Test
    void concurrentImportsAgree() throws Exception {
        Files.createDirectories(dir.resolve("state"));
        Files.writeString(dir.resolve("state/installation-id"), "CA-7F3K-29QD\n");
        Files.writeString(dir.resolve("state/revisions.properties"), "lic_x=5\n");
        Files.writeString(dir.resolve("certalert.lic"), TestLicenses.license("lic_x", 5, "CA-7F3K-29QD"));
        List<Boolean> imported = concurrently(6, () -> store(Duration.ZERO).importFileState(dir.resolve("certalert.lic"), dir.resolve("state")));
        assertTrue(imported.contains(true));
        Set<String> ids = new HashSet<>(concurrently(6, () -> manager(store(Duration.ZERO)).installationId()));
        assertEquals(Set.of("CA-7F3K-29QD"), ids);
        assertEquals(LicenseState.VALID, manager(store(Duration.ZERO)).current().state());
        assertEquals(5, store(Duration.ZERO).highestRevision("lic_x"));
    }

    @Test
    void importsOnFirstUseWhenAskedTo() throws Exception {
        Files.createDirectories(dir.resolve("state"));
        Files.writeString(dir.resolve("state/installation-id"), "CA-7F3K-29QD\n");
        Files.writeString(dir.resolve("certalert.lic"), TestLicenses.license("lic_lazy", 2, "CA-7F3K-29QD"));
        JdbcLicenseStore lazy = store(Duration.ZERO).importingFileStateOnFirstUse(dir.resolve("certalert.lic"), dir.resolve("state"));
        assertTrue(store(Duration.ZERO).storedInstallationId().isEmpty()); // nothing yet
        LicenseManager m = manager(lazy);
        assertEquals(LicenseState.VALID, m.current().state());
        assertEquals("CA-7F3K-29QD", m.installationId());
        assertEquals(2, lazy.highestRevision("lic_lazy"));
    }

    @Test
    void aDatabaseOutageKeepsTheLicenseInForce() throws Exception {
        AtomicBoolean down = new AtomicBoolean();
        DataSource flaky = TestLicenses.failingWhen(dataSource(), down);
        LicenseManager m = manager(new JdbcLicenseStore(flaky, "certalert", Duration.ZERO));
        String id = m.installationId();
        assertEquals(LicenseState.VALID, m.install(TestLicenses.license("lic_outage", 2, id)).state());
        down.set(true);
        assertEquals(LicenseState.VALID, m.current().state());
        assertEquals(2, m.current().license().orElseThrow().revision());
        assertThrows(java.io.IOException.class, () -> m.install(TestLicenses.license("lic_outage", 3, id)));
        down.set(false);
        assertEquals(LicenseState.VALID, m.install(TestLicenses.license("lic_outage", 3, id)).state());
        assertEquals(3, manager(store(Duration.ZERO)).current().license().orElseThrow().revision());
    }

    @Test
    void withNothingReadYetAnOutageIsReported() throws Exception {
        AtomicBoolean down = new AtomicBoolean(true);
        LicenseManager m = manager(new JdbcLicenseStore(TestLicenses.failingWhen(dataSource(), down), "certalert", Duration.ZERO));
        LicenseCheck c = m.current();
        assertEquals(LicenseState.INVALID, c.state());
        assertTrue(c.message().contains("can't be read"), c.message());
    }
}
