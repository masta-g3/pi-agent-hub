export function cliTuiCommand(input: { nodePath: string; cliPath: string }): string {
  return `${shellQuote(input.nodePath)} ${shellQuote(input.cliPath)} tui`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
