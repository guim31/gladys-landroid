// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, and the four documentation files, with the same sections. German says
// "du", never the polite "Sie".
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import {
  COMMAND_ERRORS,
  ERROR_TEXT,
  MESSAGES,
  NAMES,
  STATUS_TEXT,
  TRANSPORT_TEXT,
  WIDGET_TEXT,
  checkReport,
} from '../src/i18n.js';
import { ERROR_KEYS, STATUS_KEYS } from '../src/worx/codes.js';
import { F } from '../src/devices.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  short: 40,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(value, `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
});

test('the name is short, recognizable and the same in every language', () => {
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 50, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the catalog description holds 10 characters at least in every language', () => {
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

test('the feature names exist in every language, for every feature', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
  assert.deepEqual(sorted(Object.keys(NAMES.en)), sorted(Object.values(F)));
});

test('every status and error code has a text in every language', () => {
  assert.deepEqual(tableProblems(STATUS_TEXT, 'STATUS_TEXT', MAX.short), []);
  assert.deepEqual(tableProblems(ERROR_TEXT, 'ERROR_TEXT', MAX.short), []);
  for (const key of [
    ...Object.values(STATUS_KEYS),
    'offline',
    'error',
    'rain',
    'charging',
    'unknown',
  ]) {
    assert.ok(STATUS_TEXT.en[key], `no status text for ${key}`);
  }
  for (const key of [...Object.values(ERROR_KEYS), 'unknown']) {
    assert.ok(ERROR_TEXT.en[key], `no error text for ${key}`);
  }
});

test('every message of the code has the four languages', () => {
  const found = [
    ...Object.entries(MESSAGES).flatMap(([k, v]) => problems(v, `MESSAGES.${k}`, MAX.message)),
    ...Object.entries(COMMAND_ERRORS).flatMap(([k, v]) =>
      problems(v, `COMMAND_ERRORS.${k}`, MAX.short + 20),
    ),
    ...Object.entries(TRANSPORT_TEXT).flatMap(([k, v]) =>
      problems(v, `TRANSPORT_TEXT.${k}`, MAX.message),
    ),
    ...problems(
      checkReport({ mowers: [{ name: 'Jardin', online: true }], realtime: true, commandsLeft: 50 }),
      'checkReport',
      MAX.message,
    ),
  ];
  assert.deepEqual(found, []);
  // The widget: labels and buttons are short, the sentences may be longer.
  const long = new Set(['pick', 'unknown', 'notConfigured']);
  const widget = tableProblems(WIDGET_TEXT, 'WIDGET_TEXT', MAX.message).concat(
    LANGS.flatMap((lang) =>
      Object.entries(WIDGET_TEXT[lang])
        .filter(([key]) => !long.has(key))
        .flatMap(([key, text]) => textProblems(text, `WIDGET_TEXT.${lang}.${key}`, lang, 24)),
    ),
  );
  assert.deepEqual(widget, []);
});

test('the four documentation files have the same sections', async () => {
  const headings = {};
  for (const lang of LANGS) {
    const text = await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8');
    assert.ok(text.length >= 2000, `docs/${lang}.md is too short`);
    headings[lang] = text.split('\n').filter((line) => /^#{1,3} /.test(line));
    if (lang === 'de') {
      const polite = text.split('\n').filter((line) => POLITE_GERMAN.test(line));
      assert.deepEqual(polite, [], 'docs/de.md uses the polite form');
    }
  }
  const shape = (list) => list.map((line) => line.match(/^#+/)[0]);
  for (const lang of LANGS) {
    assert.deepEqual(
      shape(headings[lang]),
      shape(headings.en),
      `docs/${lang}.md sections differ from docs/en.md`,
    );
  }
  assert.ok(headings.en.length >= 10, 'the documentation has its sections');
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Lawn', fr: 'Pelouse', de: 'Rasen' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Lawn', fr: 'Pelouse', de: '', es: 'Césped' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Mäher', 'Ihre App', 'mit Ihrem', 'Ihnen']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.config_schema[2].placeholder.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.config_schema[2].placeholder has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});
