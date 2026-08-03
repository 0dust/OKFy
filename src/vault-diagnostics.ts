export const VAULT_DIAGNOSTIC_CODES = new Set([
  "unresolved_wikilink",
  "ambiguous_wikilink",
  "missing_wikilink_fragment"
]);

export function isVaultDiagnosticCode(code: string): boolean {
  return VAULT_DIAGNOSTIC_CODES.has(code);
}
