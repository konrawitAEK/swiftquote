package com.swiftquote;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

/** Postgres 16 initialised from the shared db/migrations, exactly like docker-compose and the Go CI job. */
@TestConfiguration(proxyBeanMethods = false)
public class TestcontainersConfiguration {

	@Bean
	@ServiceConnection
	public PostgreSQLContainer postgresContainer() {
		return new PostgreSQLContainer(DockerImageName.parse("postgres:16-alpine")).withDatabaseName("swiftquote")
			.withCopyFileToContainer(MountableFile.forHostPath("../../db/migrations"), "/docker-entrypoint-initdb.d/");
	}

}
