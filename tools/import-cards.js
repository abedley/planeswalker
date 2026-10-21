#!/usr/bin/env node
/**
 * Imports card definitions from Scryfall into src/cards/importedCards.js.
 *
 * Cards that do anything the engine doesn't support yet are not imported; the
 * report lists what's missing for each one. Node-only: nothing in the site
 * imports this file.
 *
 * Usage:
 *   node tools/import-cards.js "Llanowar Elves" "Serra Angel"
 *   node tools/import-cards.js --file cards.txt          (one card per line, see parseCardLine)
 *   node tools/import-cards.js "Shock (M21)"             (a particular printing, for its art)
 *   node tools/import-cards.js --query "set:fdn t:creature c:g"
 *   node tools/import-cards.js --dry-run "Giant Spider"  (report only, write nothing)
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { convertScryfallCard, presentation as presentationOf } from './scryfall/convert.js';
import { fetchCollection, searchCards } from './scryfall/client.js';
import { readImportedModule, writeImportedCards } from './scryfall/importedModule.js';
import { HAND_WRITTEN_CARDS } from '../src/cards/cards.js';

const OUTPUT = fileURLToPath(new URL('../src/cards/importedCards.js', import.meta.url));

/**
 * One line of a card list: `Shock`, `Shock (M21)`, `Shock|m21` or `4 Shock (M21)`
 * (a count is ignored). Returns `{ name, set? }`, or null for a blank or comment line.
 */
export function parseCardLine(line) {
  const text = line.replace(/#.*/, '').trim().replace(/^\d+x?\s+/, '');
  if (!text) return null;
  const match = /^(.*?)\s*(?:\(([A-Za-z0-9]{2,6})\)|\|\s*([A-Za-z0-9]{2,6}))$/.exec(text);
  if (!match) return { name: text };
  return { name: match[1], set: (match[2] ?? match[3]).toLowerCase() };
}

/**
 * Converts Scryfall cards and merges the supported ones into `existing`. Cards
 * defined by hand aren't replaced, but their art (presentation) is recorded.
 * Returns the merged cards and presentation, plus a report.
 */
export function importCards(scryfallCards, existing = {}, existingPresentation = {}) {
  const cards = { ...existing };
  const presentation = { ...existingPresentation };
  const imported = [];
  const updated = [];
  const decorated = [];
  const skipped = [];
  for (const card of scryfallCards) {
    const result = convertScryfallCard(card);
    if (!result.ok) {
      skipped.push({ name: result.name, problems: result.problems });
    } else if (HAND_WRITTEN_CARDS[result.id]) {
      const fields = presentationOf(card);
      if (Object.keys(fields).length) {
        presentation[result.id] = fields;
        decorated.push(card.name);
      } else {
        skipped.push({ name: card.name, problems: [`"${result.id}" is defined by hand in src/cards/cards.js.`] });
      }
    } else {
      (cards[result.id] ? updated : imported).push(card.name);
      cards[result.id] = result.definition;
    }
  }
  return { cards, presentation, imported, updated, decorated, skipped };
}

function printReport({ imported, updated, decorated, skipped, notFound }) {
  if (imported.length) console.log(`Imported (${imported.length}):\n${imported.map((n) => `  + ${n}`).join('\n')}`);
  if (updated.length) console.log(`Updated (${updated.length}):\n${updated.map((n) => `  ~ ${n}`).join('\n')}`);
  if (decorated.length) console.log(`Art for hand-written cards (${decorated.length}):\n${decorated.map((n) => `  * ${n}`).join('\n')}`);
  if (skipped.length) {
    console.log(`Not imported — uses things the game doesn't support yet (${skipped.length}):`);
    for (const { name, problems } of skipped) {
      console.log(`  - ${name}`);
      for (const problem of problems) console.log(`      ${problem}`);
    }
  }
  if (notFound.length) console.log(`Not found on Scryfall (${notFound.length}):\n${notFound.map((n) => `  ? ${n}`).join('\n')}`);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      file: { type: 'string' },
      query: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const lines = [...positionals];
  if (values.file) lines.push(...(await readFile(values.file, 'utf8')).split('\n'));
  const wanted = lines.map(parseCardLine).filter(Boolean);
  if (values.help || (wanted.length === 0 && !values.query)) {
    console.log('Usage: node tools/import-cards.js [--dry-run] [--file cards.txt] [--query "scryfall search"] [card names, e.g. "Shock (M21)"...]');
    return;
  }

  const unique = [...new Map(wanted.map((card) => [`${card.name.toLowerCase()}|${card.set ?? ''}`, card])).values()];
  const scryfallCards = [];
  const notFound = [];
  if (unique.length) {
    // One request per 75 cards, rather than one per card.
    const found = await fetchCollection(unique);
    scryfallCards.push(...found.cards);
    notFound.push(...found.notFound.map(({ name, set }) => (set ? `${name} (${set.toUpperCase()})` : name)));
  }
  if (values.query) scryfallCards.push(...await searchCards(values.query));

  const existing = await readImportedModule(OUTPUT);
  const result = importCards(scryfallCards, existing.cards, existing.presentation);
  printReport({ ...result, notFound });
  if (values['dry-run']) {
    console.log('Dry run: nothing written.');
  } else if (result.imported.length || result.updated.length || result.decorated.length) {
    await writeImportedCards(OUTPUT, result.cards, result.presentation);
    console.log(`Wrote ${Object.keys(result.cards).length} card(s) to src/cards/importedCards.js.`);
  }
  if (result.skipped.length || notFound.length) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Import failed: ${error.message}`);
    process.exitCode = 2;
  });
}
