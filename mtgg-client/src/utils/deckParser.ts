import type { DeckEntry, ParsedDeck } from '../types';

/**
 * Parses Moxfield / MTGO / Arena plain-text decklist formats.
 *
 * Supported section headers (case-insensitive):
 *   Commander, Commanders, Companion, Sideboard, Maybeboard
 * Lines without a section are treated as mainboard.
 *
 * Line formats handled:
 *   1 Sol Ring
 *   1x Sol Ring
 *   1 Sol Ring (NEO) 123
 *   1 Sol Ring *F*
 */
export function parseDeck(raw: string): ParsedDeck {
  const result: ParsedDeck = { commander: [], main: [], errors: [] };

  const COMMANDER_SECTIONS = new Set(['commander', 'commanders', 'companion']);
  const SKIP_SECTIONS      = new Set(['sideboard', 'maybeboard', 'tokens', 'maybe board']);

  let currentSection: 'main' | 'commander' | 'skip' = 'main';

  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Section header: a line that contains no leading digit and ends with optional parenthesized count
    // e.g. "Commander (1)" or "Creatures (30)" or "// Lands"
    if (/^\/\//.test(line)) continue; // comment line

    const sectionMatch = line.match(/^([a-zA-Z][a-zA-Z\s]*)(?:\s*\(\d+\))?\s*$/);
    if (sectionMatch) {
      const header = sectionMatch[1].trim().toLowerCase();
      if (COMMANDER_SECTIONS.has(header)) {
        currentSection = 'commander';
      } else if (SKIP_SECTIONS.has(header)) {
        currentSection = 'skip';
      } else {
        currentSection = 'main';
      }
      continue;
    }

    if (currentSection === 'skip') continue;

    // Card line: optional quantity prefix
    // Formats: "1 Card Name", "1x Card Name", "Card Name" (qty=1)
    const cardMatch = line.match(/^(\d+)[xX]?\s+(.+?)(?:\s+\([A-Z0-9]+\)\s+\d+)?(?:\s+\*[^*]+\*)?$/);
    if (cardMatch) {
      const quantity = parseInt(cardMatch[1], 10);
      const name     = cardMatch[2].trim();
      if (!name) continue;
      const entry: DeckEntry = { quantity, name, isCommander: currentSection === 'commander' };
      if (currentSection === 'commander') {
        result.commander.push(entry);
      } else {
        result.main.push(entry);
      }
    } else {
      // Might be a single card with no quantity
      const nameOnly = line.match(/^([a-zA-Z].*?)(?:\s+\([A-Z0-9]+\)\s+\d+)?$/);
      if (nameOnly) {
        const name = nameOnly[1].trim();
        if (currentSection === 'commander') {
          result.commander.push({ quantity: 1, name, isCommander: true });
        } else {
          result.main.push({ quantity: 1, name, isCommander: false });
        }
      } else {
        result.errors.push(`Could not parse line: "${line}"`);
      }
    }
  }

  return result;
}
