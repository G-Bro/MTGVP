import type { ScryfallCard, GameCard } from '../types';

const SCRYFALL_COLLECTION = 'https://api.scryfall.com/cards/collection';

// Scryfall /cards/collection accepts up to 75 identifiers per request.
const BATCH_SIZE = 75;

export interface FetchResult {
  found: GameCard[];
  notFound: string[];
}

function pickImage(card: ScryfallCard): { normal: string; large: string } {
  if (card.image_uris) {
    return { normal: card.image_uris.normal, large: card.image_uris.large };
  }
  // Double-faced cards: use front face
  if (card.card_faces?.[0]?.image_uris) {
    return {
      normal: card.card_faces[0].image_uris.normal,
      large:  card.card_faces[0].image_uris.large,
    };
  }
  return {
    normal: 'https://cards.scryfall.io/normal/back/0/0/00000000-0000-0000-0000-000000000000.jpg',
    large:  'https://cards.scryfall.io/large/back/0/0/00000000-0000-0000-0000-000000000000.jpg',
  };
}

function scryfallToGameCard(sf: ScryfallCard): Omit<GameCard, 'instanceId' | 'tapped' | 'counters' | 'position' | 'faceDown'> {
  const imgs = pickImage(sf);
  return {
    scryfallId:    sf.id,
    name:          sf.name,
    imageUri:      imgs.normal,
    largeImageUri: imgs.large,
    typeLine:      sf.type_line ?? '',
    manaCost:      sf.mana_cost ?? '',
    oracleText:    sf.oracle_text ?? '',
  };
}

/**
 * Fetches card data for a flat list of card names using Scryfall's
 * /cards/collection endpoint (up to 75 per call).
 * Returns fully-formed GameCard objects (without instanceId – callers assign that).
 */
export async function fetchCardsByName(names: string[]): Promise<FetchResult> {
  const unique  = [...new Set(names)];
  const found:    GameCard[] = [];
  const notFound: string[]   = [];

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const body  = { identifiers: batch.map(name => ({ name })) };

    try {
      const response = await fetch(SCRYFALL_COLLECTION, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (!response.ok) {
        batch.forEach(n => notFound.push(n));
        continue;
      }

      const data = await response.json() as {
        data: ScryfallCard[];
        not_found: { name: string }[];
      };

      for (const sf of data.data) {
        const card = scryfallToGameCard(sf);
        found.push({
          ...card,
          instanceId: crypto.randomUUID(),
          tapped:     false,
          counters:   {},
          position:   { x: 0, y: 0 },
          faceDown:   false,
        });
      }

      for (const nf of data.not_found ?? []) {
        notFound.push(nf.name);
      }
    } catch {
      batch.forEach(n => notFound.push(n));
    }

    // Respect Scryfall's 10 req/s soft limit between batches
    if (i + BATCH_SIZE < unique.length) {
      await new Promise(r => setTimeout(r, 110));
    }
  }

  return { found, notFound };
}

/**
 * Builds an expanded list (respecting quantities) from a fetch result + entries.
 * Commander cards are prepended.
 */
export function expandDeckToCards(
  fetchResult: FetchResult,
  entries: { name: string; quantity: number; isCommander: boolean }[],
): { cards: GameCard[]; notFound: string[] } {
  const byName = new Map(fetchResult.found.map(c => [c.name.toLowerCase(), c]));
  const cards:    GameCard[] = [];
  const notFound: string[]   = [];

  for (const entry of entries) {
    const template = byName.get(entry.name.toLowerCase());
    if (!template) {
      notFound.push(entry.name);
      continue;
    }
    for (let q = 0; q < entry.quantity; q++) {
      cards.push({
        ...template,
        instanceId: crypto.randomUUID(),
        tapped:     false,
        counters:   {},
        position:   { x: 0, y: 0 },
        faceDown:   false,
      });
    }
  }

  return { cards, notFound };
}
