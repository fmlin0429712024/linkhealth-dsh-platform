// linkhealth-gui-plugin — host half.
//
// Deliberately a no-op: this plugin is presentation only and lives entirely
// in the browser half (`./client.js`). The loader imports this entry on the
// host plane too, so it must be a valid Cordis plugin — an empty `apply` is
// all the host needs (there is no host service, tool, or skill here).

export const name = 'linkhealth-gui-plugin'

export function apply() {
  // Intentionally nothing: see PRD-gui-plugin.md §7 (client only).
}
