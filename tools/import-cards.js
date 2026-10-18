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
 *   node tools/import-cards.js --file cards.txt          (one card name per line)
 *   node tools/import-cards.js --query "set:fdn t:creature c:g"
 *   node tools/import-cards.js --dry-run "Giant Spider"  (report only, write nothing)
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { convertScryfallCard } from './scryfall/convert.js';
import { fetchCardByName, searchCards } from './scryfall/client.js';
import { readImportedCards, writeImportedCards } from './scryfall/importedModule.js';
import { HAND_WRITTEN_CARDS } from '../src/cards/cards.js';

const OUTPUT = fileURLToPath(new URL('../src/cards/importedCards.js', import.meta.url));

/**
 * Converts Scryfall cards and merges the supported ones into `existing`.
 * Returns the merged cards plus a report.
 */
export function importCards(scryfallCards, existing = {}) {
  const cards = { ...existing };
  const imported = [];
  const updated = [];
  const skipped = [];
  for (const card of scryfallCards) {
    const result = convertScryfallCard(card);
    if (!result.ok) {
      skipped.push({ name: result.name, problems: result.problems });
    } else if (HAND_WRITTEN_CARDS[result.id]) {
      skipped.push({ name: card.name, problems: [`"${result.id}" is defined by hand in src/cards/cards.js.`] });
    } else {
      (cards[result.id] ? updated : imported).push(card.name);
      cards[result.id] = result.definition;
    }
  }
  return { cards, imported, updated, skipped };
}

function printReport({ imported, updated, skipped, notFound }) {
  if (imported.length) console.log(`Imported (${imported.length}):\n${imported.map((n) => `  + ${n}`).join('\n')}`);
  if (updated.length) console.log(`Updated (${updated.length}):\n${updated.map((n) => `  ~ ${n}`).join('\n')}`);
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
  const names = [...positionals];
  if (values.file) {
    const text = await readFile(values.file, 'utf8');
    names.push(...text.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean));
  }
  if (values.help || (names.length === 0 && !values.query)) {
    console.log('Usage: node tools/import-cards.js [--dry-run] [--file names.txt] [--query "scryfall search"] [card names...]');
    return;
  }

  const scryfallCards = [];
  const notFound = [];
  for (const name of names) {
    try {
      scryfallCards.push(await fetchCardByName(name));
    } catch (error) {
      if (error.status === 404) notFound.push(name);
      else throw error;
    }
  }
  if (values.query) scryfallCards.push(...await searchCards(values.query));

  const existing = await readImportedCards(OUTPUT);
  const result = importCards(scryfallCards, existing);
  printReport({ ...result, notFound });
  if (values['dry-run']) {
    console.log('Dry run: nothing written.');
  } else if (result.imported.length || result.updated.length) {
    await writeImportedCards(OUTPUT, result.cards);
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
