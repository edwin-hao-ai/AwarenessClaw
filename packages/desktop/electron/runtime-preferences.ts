import fs from 'fs';
import os from 'os';
import path from 'path';

export type RuntimePreferences = {
  preferUserSessionGateway?: boolean;
  completedMigrations?: string[];
};

const HOME = os.homedir();

export function getRuntimePreferencesPath() {
  return path.join(HOME, '.awareness-claw', 'runtime-preferences.json');
}

export function readRuntimePreferences(): RuntimePreferences {
  try {
    const file = getRuntimePreferencesPath();
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8')) as RuntimePreferences;
  } catch {
    return {};
  }
}

export function hasCompletedRuntimeMigration(preferences: RuntimePreferences, migrationId: string): boolean {
  return Array.isArray(preferences.completedMigrations)
    && preferences.completedMigrations.includes(migrationId);
}

export function markRuntimeMigrationCompleted(
  preferences: RuntimePreferences,
  migrationId: string,
): RuntimePreferences {
  return {
    ...preferences,
    completedMigrations: Array.from(new Set([...(preferences.completedMigrations || []), migrationId])),
  };
}

export function writeRuntimePreferences(next: RuntimePreferences) {
  try {
    const file = getRuntimePreferencesPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2));
  } catch {
    // Best-effort preference cache only.
  }
}