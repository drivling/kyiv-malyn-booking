#!/usr/bin/env bash
# Запускає Gradle з JAVA_HOME із gradle.properties (щоб і агент Cursor міг збирати проєкт).
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
PROPS="$SCRIPT_DIR/gradle.properties"
if [ -f "$PROPS" ]; then
  JAVA_HOME_LINE=$(grep '^org.gradle.java.home=' "$PROPS" 2>/dev/null || true)
  if [ -n "$JAVA_HOME_LINE" ]; then
    export JAVA_HOME="${JAVA_HOME_LINE#org.gradle.java.home=}"
  fi
fi
exec ./gradlew "$@"
