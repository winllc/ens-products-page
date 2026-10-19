package com.enssolutions.license;

import javax.sql.DataSource;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** {@link JdbcLicenseStoreContract} on PostgreSQL 17 (Testcontainers), with the PostgreSQL DDL. */
class JdbcLicenseStorePostgresTest extends JdbcLicenseStoreContract {
    static PostgreSQLContainer db;
    static DataSource dataSource;

    @BeforeAll
    static void start() throws Exception {
        Databases.requireDocker();
        db = new PostgreSQLContainer("postgres:17-alpine");
        db.start();
        dataSource = TestLicenses.dataSource(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        TestLicenses.runDdl(dataSource, JdbcLicenseStore.Dialect.POSTGRESQL.ddl());
    }

    @AfterAll
    static void stop() {
        if (db != null) db.stop();
    }

    @Override
    DataSource dataSource() {
        return dataSource;
    }
}
