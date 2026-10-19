package com.enssolutions.license;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

import org.testcontainers.DockerClientFactory;

/** Docker for the PostgreSQL and MySQL tests. */
final class Databases {
    private Databases() {}

    /**
     * Without Docker the real-database tests can't run. On a CI runner (CI set, as GitHub Actions
     * sets it) that is a failure; on a developer machine they are skipped, and the H2
     * compatibility-mode tests still run.
     */
    static void requireDocker() {
        boolean docker = DockerClientFactory.instance().isDockerAvailable();
        if (!docker && System.getenv("CI") != null) {
            throw new IllegalStateException("Docker is needed for the PostgreSQL and MySQL license store tests");
        }
        assumeTrue(docker, "Docker is not available");
    }
}
