FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN ./mvnw -B -q dependency:go-offline
COPY src src
# Tests need Docker (Testcontainers) and the repo's migrations; CI runs them instead.
RUN ./mvnw -B -q package -DskipTests && cp target/*.jar /app.jar

FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 app
USER app
COPY --from=build /app.jar /app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app.jar"]
