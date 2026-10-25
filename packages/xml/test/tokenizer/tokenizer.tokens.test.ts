import { describeToken, pieces, textSource, tokens } from '@test/helpers/lexical.ts';
import { describe, expect, it } from 'vitest';
import { DecodingFailureError, type TextSource } from '@/input/source.ts';
import { TABLES_XML_10, TABLES_XML_11, TABLES_REPLACEMENT_TEXT } from '@/scan/classes.ts';
import { ScanFlag } from '@/scan/scanner.ts';
import { Token, Tokenizer, type TokenizerOptions } from '@/tokenizer/tokenizer.ts';

/** A started tokenizer over text given in chunks. */
function tokenizer(chunks: readonly (string | null)[], options: Partial<TokenizerOptions> = {}): Tokenizer {
  const t = new Tokenizer(textSource(...chunks), { maxNameLength: 1000, ...options });
  t.readDeclaration();
  return t;
}

/** Reads to the token after `skip` others, ignoring requests for input. */
function nth(t: Tokenizer, skip: number): Tokenizer {
  for (let n = 0; n <= skip; n++) while (t.next() === Token.NEED_INPUT);
  return t;
}

/** A source that gives the chunks, then throws what `failure` makes. */
function failing(failure: () => Error, ...chunks: string[]): TextSource {
  const queue = [...chunks];
  return {
    detection: undefined,
    read() {
      const chunk = queue.shift();
      if (chunk === undefined) throw failure();
      return chunk;
    },
  };
}

/** Documents with every kind of token, for the chunking tests. */
const CORPUS = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<!DOCTYPE r PUBLIC "-//A//B" \'r.dtd\' [<!ENTITY e "a>b"> %p; <?pi x?><!-- ] \' -->]>\n<r a="1" b=\'x&amp;y&e;\'>t&lt;&#x41;&e;<![CDATA[ c ]] ]]><!-- c --><?pi  d ?><e/></r >\n<!--end-->',
  '<a>\r\nx\ry]]y]x</a>',
  `<a b="1\t\n\r2">${'x'.repeat(100)}\r\n${'y'.repeat(200)}</a>`,
  `<a b="${'v'.repeat(40)}&amp;${'w'.repeat(40)}">${'é'.repeat(140)}Ā${'z'.repeat(140)}</a>`,
  '<a>&#65;&#x42;&amp;&e;rest</a>',
  '<é b="ü">𝄞</é><x:y z:w="1"/>',
  `<r>${'<e xmlns:p="urn:a-long-namespace" p:x="1"/>'.repeat(3)}<e xmlns:p="urn:a-long-namespace" p:x="1" q="2"/></r>`,
  '<a>]]></a>',
  '<a>&#0;</a>',
  '<a><!-- a -- b --></a>',
  `<a><!--${'c'.repeat(50)}\r${'d'.repeat(50)}--><?p ${'e'.repeat(60)}?><![CDATA[${'f'.repeat(60)}]]></a>`,
];

describe('tokens', () => {
  it('records each kind of token as spans of the buffer', () => {
    expect(tokens(['<a b="1" c=\'2\'>t<![CDATA[c]]><!--m--><?p d?><e/></a >'])).toEqual([
      '<a b="1" c="2">',
      'text "t"',
      'cdata "c"',
      'comment "m"',
      'pi p "d"',
      '<e/>',
      '</a>',
    ]);
  });

  it('delimits the DOCTYPE: its name, external identifier and internal subset', () => {
    expect(tokens(['<!DOCTYPE a PUBLIC "-//X//Y" \'a.dtd\' [ <!ENTITY e "]>"> ] ><a/>'])).toEqual([
      'doctype a -//X//Y a.dtd [ <!ENTITY e "]>"> ]',
      '<a/>',
    ]);
    expect(tokens(['<!DOCTYPE a SYSTEM "a.dtd"><a/>'])[0]).toBe('doctype a - a.dtd');
    expect(tokens(['<!DOCTYPE a[]><a/>'])[0]).toBe('doctype a - - []');
    expect(tokens(['<!DOCTYPE a><a/>'])[0]).toBe('doctype a - -');
  });

  it('keeps character and predefined references inside text, and makes others tokens of their own', () => {
    expect(tokens(['<a>x&lt;&#65;y&e;z&f;</a>'])).toEqual([
      '<a>',
      'text "x&lt;&#65;y"',
      '&e;',
      'text "z"',
      '&f;',
      '</a>',
    ]);
  });

  it('starts PI data after the whitespace that follows the target, and keeps trailing whitespace', () => {
    expect(tokens(['<?pi  a  ?><?pi?><?pi ?><a/>']).slice(0, 3)).toEqual(['pi pi "a  "', 'pi pi ""', 'pi pi ""']);
  });

  it('ends whitespace before a tag as text of its own', () => {
    expect(tokens([' \n\t<a/>'])).toEqual([String.raw`text " \n\t"`, '<a/>']);
  });

  it('keeps giving END once the text has ended', () => {
    const t = tokenizer(['<a/>']);
    nth(t, 0);
    expect([t.next(), t.next()]).toEqual([Token.END, Token.END]);
  });

  it('records where each token starts and where the next begins', () => {
    const t = tokenizer(['<a>xy</a>']);
    expect([t.next(), t.tokenStart, t.nextTokenStart]).toEqual([Token.START_TAG, 0, 3]);
    expect([t.next(), t.tokenStart, t.nextTokenStart, t.valueStart, t.valueEnd]).toEqual([Token.TEXT, 3, 5, 3, 5]);
    expect([t.next(), t.tokenStart, t.nextTokenStart, t.nameStart, t.nameEnd]).toEqual([Token.END_TAG, 5, 9, 7, 8]);
  });
});

describe('flags and colons', () => {
  it('flags CR and references in text, and CR in comments, PIs and CDATA sections', () => {
    expect(nth(tokenizer(['<a>x\r\ny</a>']), 1).valueFlags).toBe(ScanFlag.CR);
    expect(nth(tokenizer(['<a>x&amp;</a>']), 1).valueFlags).toBe(ScanFlag.REFERENCE);
    expect(nth(tokenizer(['<a>xy</a>']), 1).valueFlags).toBe(0);
    for (const markup of ['<!--\r-->', '<?p x\r?>', '<![CDATA[\r]]>']) {
      expect(nth(tokenizer([`<a>${markup}</a>`]), 1).valueFlags, markup).toBe(ScanFlag.CR);
    }
  });

  it('flags NEL and LS in XML 1.1, in text, comments, PIs and CDATA sections', () => {
    expect(nth(tokenizer(['<?xml version="1.1"?><a>x\u0085y</a>']), 1).valueFlags).toBe(ScanFlag.NEL);
    const xml = '<?xml version="1.1"?><a><!--\u0085--><?p x\u2028?><![CDATA[\u0085]]></a>';
    for (let skip = 1; skip <= 3; skip++) expect(nth(tokenizer([xml]), skip).valueFlags).toBe(ScanFlag.NEL);
    expect(tokens(['<?xml version="1.1"?><a><!--x--><?p y?><![CDATA[z]]></a>'])).toEqual([
      '<a>',
      'comment "x"',
      'pi p "y"',
      'cdata "z"',
      '</a>',
    ]);
  });

  it('flags what each attribute value needs, and all of them together on the tag', () => {
    const t = nth(tokenizer(['<a p="1" q="\t" r="\r" s="&amp;" t="&e;"/>']), 0);
    expect(Array.from(t.attributeFlags.subarray(0, t.attributeCount))).toEqual([
      0,
      ScanFlag.WHITESPACE,
      ScanFlag.WHITESPACE | ScanFlag.CR,
      ScanFlag.REFERENCE,
      ScanFlag.REFERENCE | ScanFlag.ENTITY,
    ]);
    expect(t.allAttributeFlags).toBe(ScanFlag.WHITESPACE | ScanFlag.CR | ScanFlag.REFERENCE | ScanFlag.ENTITY);
  });

  it('records the first colon and the number of colons of each name', () => {
    const t = nth(tokenizer(['<p:a b:c:d="1" e="2"/>']), 0);
    expect([t.nameFirstColon, t.nameColonCount]).toEqual([2, 1]);
    expect([
      t.attributeFirstColon[0],
      t.attributeColonCount[0],
      t.attributeFirstColon[1],
      t.attributeColonCount[1],
    ]).toEqual([6, 2, -1, 0]);
    expect([
      nth(tokenizer(['<?a:b?><r/>']), 0).nameFirstColon,
      nth(tokenizer(['<r>&a:b;</r>']), 1).nameColonCount,
    ]).toEqual([3, 1]);
  });

  it('takes a predefined name with a colon for another entity', () => {
    expect(tokens(['<r>&lt:x;</r>'])).toEqual(['<r>', '&lt:x;', '</r>']);
  });
});

describe('chunks', () => {
  it.each(CORPUS.map((xml) => [JSON.stringify(xml).slice(0, 40), xml]))(
    'gives the same tokens at every split point of %s',
    (_, xml) => {
      const whole = tokens([xml]);
      for (let k = 1; k < xml.length; k++)
        expect(tokens([xml.slice(0, k), xml.slice(k)]), `split at ${k}`).toEqual(whole);
      expect(tokens(pieces(xml, 1))).toEqual(whole);
      expect(tokens(pieces(xml, 3))).toEqual(whole);
    }
  );

  it.each(CORPUS.map((xml) => [JSON.stringify(xml).slice(0, 40), xml]))(
    'gives the same tokens when every character waits for input, for %s',
    (_, xml) => {
      const waiting = tokens(Array.from(xml).flatMap((c) => [null, c]));
      expect(waiting).toContain('need input');
      expect(waiting.filter((token) => token !== 'need input')).toEqual(tokens([xml]));
    }
  );

  it('reports NEED_INPUT while a token waits for text, and goes on when it comes', () => {
    const t = tokenizer(['<a>xyz', null, 'w</a>']);
    expect(t.next()).toBe(Token.START_TAG);
    expect(t.next()).toBe(Token.NEED_INPUT);
    expect(t.kind).toBe(Token.NEED_INPUT);
    expect(t.next()).toBe(Token.TEXT);
    expect(describeToken(t)).toBe('text "xyzw"');
  });

  it('waits for the end of the XML declaration before starting', () => {
    const t = new Tokenizer(textSource('<?xml', null, ' version="1.1"', null, '?><a/>'), { maxNameLength: 100 });
    expect([t.readDeclaration(), t.readDeclaration(), t.readDeclaration()]).toEqual([false, false, true]);
    expect([t.declaration?.version, t.version11, t.nextTokenStart]).toEqual(['1.1', true, 21]);
  });

  it('decides there is no declaration as soon as the first characters rule one out', () => {
    const start = (...chunks: (string | null)[]): (boolean | string | undefined)[] => {
      const t = new Tokenizer(textSource(...chunks), { maxNameLength: 100 });
      return [t.readDeclaration(), t.readDeclaration(), t.readDeclaration(), t.declaration?.version];
    };
    expect(start('<a', null, '>')).toEqual([true, true, true, undefined]);
    expect(start('<?', null, 'p?>', null)).toEqual([false, true, true, undefined]);
    expect(start('<?xm', null, 'l', null, '-p?>')).toEqual([false, false, true, undefined]);
  });

  it('gives markup as soon as it is complete, without waiting for text after it', () => {
    expect(tokens(['<a/>', null, '<b/>'])).toEqual(['<a/>', 'need input', '<b/>']);
    expect(tokens(['<a><!--c-->', null, '<!---->', null, '</a>'])).toEqual([
      '<a>',
      'comment "c"',
      'need input',
      'comment ""',
      'need input',
      '</a>',
    ]);
    expect(tokens(['<!DOCTYPE r>', null, '<r/>'])).toEqual(['doctype r - -', 'need input', '<r/>']);
    expect(tokens(['<!DOCTYPE r []>', null, '<r/>'])).toEqual(['doctype r - - []', 'need input', '<r/>']);
  });

  it('waits after <! and after a DOCTYPE name while what follows could still begin a keyword', () => {
    expect(tokens(['<a><!', null, '-', null, '-c-->', '</a>'])).toEqual([
      '<a>',
      'need input',
      'need input',
      'comment "c"',
      '</a>',
    ]);
    expect(tokens(['<!DOCTYPE r SYS', null, 'TEM "s">'])).toEqual(['need input', 'doctype r - s']);
    expect(tokens(['<a><!-x', null])).toEqual(['<a>', 'WF_MARKUP @3']);
    expect(tokens(['<!DOCTYPE r SYSX', null])).toEqual(['WF_DOCTYPE @12']);
  });

  it('drops the text before the current token when more arrives, telling the caller first', () => {
    const t = tokenizer(['<a>xxxx', 'yyyy</a>']);
    const compacted: number[] = [];
    t.onDrop = (offset) => compacted.push(offset);
    nth(t, 1);
    expect([describeToken(t), t.bufferOffset, compacted]).toEqual(['text "xxxxyyyy"', 3, [3]]);
    expect(t.lines.locationAt(t.valueStart)).toEqual({ line: 1, column: 4, offset: 3 });
  });
});

describe('bad bytes', () => {
  it('scans the text that arrived before bad bytes, so an error in it comes first', () => {
    const decoding = () => new DecodingFailureError('bad');
    const t = new Tokenizer(failing(decoding, '<a>xxxxxxxxxx', 'y\u0001'), { maxNameLength: 100 });
    t.readDeclaration();
    t.next();
    expect(() => t.next()).toThrow(expect.objectContaining({ code: 'WF_INVALID_CHARACTER', index: 11 }));
  });

  it('fails with the bad bytes when the text before them is well-formed', () => {
    const decoding = () => new DecodingFailureError('bad');
    const t = new Tokenizer(failing(decoding, '<a>xxxxxxxxxx', 'y'), { maxNameLength: 100 });
    t.readDeclaration();
    t.next();
    expect(() => t.next()).toThrow(DecodingFailureError);
  });

  it('passes on any other failure of the source', () => {
    const t = new Tokenizer(
      failing(() => new RangeError('broken'), '<a>xxxxxxxxxx', 'y'),
      { maxNameLength: 100 }
    );
    t.readDeclaration();
    t.next();
    expect(() => t.next()).toThrow(RangeError);
  });
});

describe('the XML declaration', () => {
  it('is read by start, which then leaves it alone', () => {
    const t = tokenizer(['<?xml version="1.0" encoding="UTF-8"?><a/>']);
    expect([t.declaration, t.nextTokenStart, t.version11, t.tables]).toEqual([
      { version: '1.0', encoding: 'UTF-8' },
      38,
      false,
      TABLES_XML_10,
    ]);
    expect(t.readDeclaration()).toBe(true);
    expect(tokens(['<?xml version="1.0"?><a/>'])).toEqual(['<a/>']);
  });

  it('switches to XML 1.1 for version 1.1, unless the document has set the version', () => {
    const own = tokenizer(['<?xml version="1.1"?><a/>']);
    expect([own.version11, own.tables]).toEqual([true, TABLES_XML_11]);
    const ofDocument10 = tokenizer(['<?xml version="1.1" encoding="UTF-8"?>\u0085'], {
      version11: false,
      textDeclaration: true,
    });
    expect([ofDocument10.declaration?.version, ofDocument10.version11, ofDocument10.tables]).toEqual([
      '1.1',
      false,
      TABLES_XML_10,
    ]);
    const ofDocument11 = tokenizer(['<a/>'], { version11: true });
    expect([ofDocument11.version11, ofDocument11.tables]).toEqual([true, TABLES_XML_11]);
  });

  it('takes a text declaration in an external entity', () => {
    expect(tokenizer(['<?xml encoding="UTF-8"?>x'], { textDeclaration: true }).declaration).toEqual({
      encoding: 'UTF-8',
    });
    expect(() => tokenizer(['<?xml encoding="UTF-8"?>x'])).toThrow(
      expect.objectContaining({ code: 'WF_XML_DECLARATION' })
    );
  });

  it('is only <?xml followed by whitespace or ?>', () => {
    expect(() => tokenizer(['<?xml?><a/>'])).toThrow(expect.objectContaining({ code: 'WF_XML_DECLARATION', index: 5 }));
    expect(tokenizer(['<?xml-stylesheet?><a/>']).declaration).toBeUndefined();
    expect(tokenizer(['<?xml\u00A0version="1.0"?><a/>']).declaration).toBeUndefined();
  });
});

describe('replacement text', () => {
  it('trusts its characters and does not flag CR again, and reads no declaration', () => {
    const t = tokenizer(['\u0001\r<?xml version="1.0"?>'], { replacementText: true });
    expect([t.isReplacementText, t.tables, t.declaration]).toEqual([true, TABLES_REPLACEMENT_TEXT, undefined]);
    expect([t.next(), t.valueFlags]).toEqual([Token.TEXT, 0]);
    expect(() => t.next()).toThrow(expect.objectContaining({ code: 'WF_XML_DECLARATION_MISPLACED' }));
  });

  it('allows character references to C0 controls in an XML 1.1 document', () => {
    expect(tokens(['&#x1;'], { replacementText: true, version11: true })).toEqual(['text "&#x1;"']);
    expect(tokens(['&#x1;'], { replacementText: true })).toEqual(['WF_CHARACTER_REFERENCE @0']);
    expect(tokenizer(['x'], { replacementText: true, version11: true }).version11).toBe(false);
  });

  it('starts over on new text with reset, keeping the arrays already grown', () => {
    const attributes = Array.from({ length: 20 }, (_, i) => ` a${i}="${i}"`).join('');
    const t = tokenizer([`<e${attributes}/>`], { replacementText: true });
    nth(t, 0);
    const grown = t.attributeNameStart;
    expect(t.reset(textSource('<f g="1"/>'))).toBe(t);
    expect([t.buffer, t.bufferOffset, t.nextTokenStart, t.attributeCount, t.declaration]).toEqual([
      '',
      0,
      0,
      0,
      undefined,
    ]);
    t.readDeclaration();
    expect(describeToken(nth(t, 0))).toBe('<f g="1"/>');
    expect(t.attributeNameStart).toBe(grown);
  });
});

describe('long runs', () => {
  // Long enough that searching the rest of a run again at each line end would run far past the test's timeout.
  const lines = 'abcdefghi\r'.repeat(200_000);

  it('checks a run of lines once, in one-byte and two-byte text, and fails where XML forbids a character', () => {
    for (const wide of ['', 'Ā']) {
      const at = '<a>'.length + wide.length + lines.length;
      expect(tokens([`<a>${wide}${lines}\u0001</a>`])).toEqual(['<a>', `WF_INVALID_CHARACTER @${at}`]);
    }
  });

  it('checks a run of lines in replacement text once', () => {
    const t = tokenizer([`${lines}\u0001<b/>`], { replacementText: true });
    expect([t.next(), t.valueEnd, t.valueFlags]).toEqual([Token.TEXT, lines.length + 1, 0]);
  });
});

describe('names', () => {
  it.each([
    ['an element', '<aaaaa/>', '<aaaaaa/>', 1],
    ['an attribute', '<a bbbbb="1"/>', '<a bbbbbb="1"/>', 3],
    ['a PI target', '<?ccccc?><a/>', '<?cccccc?><a/>', 2],
    ['a DOCTYPE', '<!DOCTYPE ddddd><a/>', '<!DOCTYPE dddddd><a/>', 10],
    ['a parameter entity reference', '<!DOCTYPE d [%eeeee;]><a/>', '<!DOCTYPE d [%eeeeee;]><a/>', 14],
  ])('limits the length of %s', (_, fits, over, index) => {
    expect(tokens([fits], { maxNameLength: 5 }).at(-1)).not.toMatch(/^LIMIT/);
    expect(tokens([over], { maxNameLength: 5 }).at(-1)).toBe(`LIMIT_NAME_LENGTH @${index}`);
  });

  it('records many attributes, growing its arrays', () => {
    const attributes = Array.from({ length: 40 }, (_, i) => ` a${i}="${i}"`).join('');
    expect(tokens([`<e${attributes}/>`])).toEqual([`<e${attributes}/>`]);
    expect(nth(tokenizer([`<e${attributes}/>`]), 0).attributeCount).toBe(40);
  });
});

describe('end tags', () => {
  /** A tokenizer at the end tag after `<a>`, told the open element's name as the cursor tells it. */
  function closing(xml: string): Tokenizer {
    const t = tokenizer([xml]);
    nth(t, 0);
    t.openElementNameOffset = t.bufferOffset + t.nameStart;
    t.openElementNameLength = t.nameEnd - t.nameStart;
    return nth(t, 0);
  }

  it('matches </name> against the open element’s name in the same pass', () => {
    const t = closing('<abc></abc>');
    expect([t.kind, t.endTagMatchesOpenElement, describeToken(t)]).toEqual([Token.END_TAG, true, '</abc>']);
  });

  it('scans any other end tag, for the caller to compare', () => {
    for (const xml of ['<abc></abd>', '<abc></ab>', '<abc></abc >', '<abc></abcd>']) {
      const t = closing(xml);
      expect([t.kind, t.endTagMatchesOpenElement], xml).toEqual([Token.END_TAG, false]);
    }
    expect(describeToken(closing('<a></é \t\r\n>'))).toBe('</é>');
  });

  it('scans the end tag when the open element’s name is no longer in the buffer', () => {
    const t = tokenizer(['<abc>', 'x', 'x</abc>']);
    nth(t, 0);
    t.openElementNameOffset = t.bufferOffset + t.nameStart;
    t.openElementNameLength = 3;
    nth(t, 0);
    nth(t, 0);
    expect([t.kind, t.endTagMatchesOpenElement, describeToken(t)]).toEqual([Token.END_TAG, false, '</abc>']);
  });

  it('allows NEL and LS before > in XML 1.1 only', () => {
    expect(tokens(['<?xml version="1.1"?><a></a\u0085>']).at(-1)).toBe('</a>');
    expect(tokens(['<a></a\u0085>']).at(-1)).toBe('WF_TAG @6');
  });
});

describe('long runs in XML 1.0', () => {
  /** The flags of the token after `skip` others. */
  const flagsOf = (xml: string, skip: number): number => nth(tokenizer([xml]), skip).valueFlags;
  const x = 'x'.repeat(40);

  it('finds the end of long text natively, with the same tokens and flags', () => {
    expect(tokens([`<a>${x}${x}</a>`])).toEqual(['<a>', `text "${x}${x}"`, '</a>']);
    expect(flagsOf(`<a>${x}\r${x}</a>`, 1)).toBe(ScanFlag.CR);
    expect(flagsOf(`<a>${x}\r${x}</a><b>${x}${x}\n</b>`, 4)).toBe(0);
    expect(flagsOf(`<a>${x}\r${x}</a><b>${x}${x}\r</b>`, 4)).toBe(ScanFlag.CR);
  });

  it('finds what XML forbids in long text, wide or narrow', () => {
    const wide = 'Ā'.repeat(200);
    const latin = 'é'.repeat(200);
    expect(tokens([`<a>${latin}</a>`])[1]).toBe(`text "${latin}"`);
    expect(tokens([`<a>${wide}𝄞${wide}</a><b>${x}${x}</b>`])).toHaveLength(6);
    expect(tokens([`<a>${latin}\u0001</a>`]).at(-1)).toBe('WF_INVALID_CHARACTER @203');
    expect(tokens([`<a>${latin}\u0015</a>`]).at(-1)).toBe('WF_INVALID_CHARACTER @203');
    expect(tokens([`<a>${wide}\u0015</a>`]).at(-1)).toBe('WF_INVALID_CHARACTER @203');
    expect(tokens([`<a>${x}\uD800${x}</a>`]).at(-1)).toBe('WF_INVALID_CHARACTER @43');
    expect(tokens([`<a>${x}${x}]]>${x}</a>`]).at(-1)).toBe('WF_CDATA_END_IN_TEXT @83');
  });

  it('finds the end of long attribute values natively, with their flags', () => {
    const t = nth(
      tokenizer([`<a p="${x}${x}" q='${x}"${x}' r="${x}\t${x}" s="${x}\r\n${x}" t="${x}&amp;${x}" u="${x}\r${x}"/>`]),
      0
    );
    expect(Array.from(t.attributeFlags.subarray(0, 6))).toEqual([
      0,
      0,
      ScanFlag.WHITESPACE,
      ScanFlag.WHITESPACE | ScanFlag.CR,
      ScanFlag.REFERENCE,
      ScanFlag.WHITESPACE | ScanFlag.CR,
    ]);
    expect(tokens([`<a b="${x}<${x}"/>`]).at(-1)).toBe('WF_LT_IN_ATTRIBUTE @46');
    expect(tokens([`<a b="${x}\u0001${x}"/>`]).at(-1)).toBe('WF_INVALID_CHARACTER @46');
    expect(tokens([`<a b="${x}${x}`]).at(-1)).toBe('WF_UNEXPECTED_END @6');
  });

  it('finds the end of long comments, PIs and CDATA sections natively', () => {
    expect(flagsOf(`<a><!--${x}\r\n${x}--></a>`, 1)).toBe(ScanFlag.CR);
    expect(tokens([`<a><?p ${x}\u0001?></a>`]).at(-1)).toBe('WF_INVALID_CHARACTER @47');
    expect(tokens([`<a><![CDATA[${x}`]).at(-1)).toBe('WF_UNEXPECTED_END @3');
    expect(tokens([`<a><!--${x}--${x}--></a>`]).at(-1)).toBe('WF_COMMENT @47');
  });
});

describe('locations', () => {
  it('counts LF, CRLF and a lone CR as one line end each (§2.11)', () => {
    const t = tokenizer(['a\nb\r\nc\rd\r\re']);
    expect([0, 2, 5, 7, 9, 10].map((i) => t.lines.locationAt(i).line)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(t.lines.locationAt(8)).toEqual({ line: 4, column: 2, offset: 8 });
  });

  it('counts NEL and LS as one line end each in XML 1.1, and not in XML 1.0', () => {
    const t = tokenizer(['<?xml version="1.1"?>a\u0085b\u2028c\r\nd\re']);
    expect([21, 23, 25, 28, 30].map((i) => t.lines.locationAt(i).line)).toEqual([1, 2, 3, 4, 5]);
    expect(tokenizer(['a\u0085b\u2028c']).lines.locationAt(4).line).toBe(1);
  });

  it('counts CR NEL as one line end in XML 1.1, and a NEL after LF as another (XML 1.1 §2.11)', () => {
    const t = tokenizer(['<?xml version="1.1"?>a\r\u0085b\n\u0085c']);
    expect([23, 24, 26, 27].map((i) => t.lines.locationAt(i).line)).toEqual([1, 2, 3, 4]);
    expect(t.lines.locationAt(24)).toEqual({ line: 2, column: 1, offset: 24 });
  });

  it('moves its line checkpoint to each token it reads', () => {
    const t = tokenizer(['<a>\n<b/>\n</a>']);
    nth(t, 2);
    t.lines.locationAt(t.tokenStart);
    expect(t.lines.checkpointOffset).toBe(4);
    nth(t, 1);
    t.lines.locationAt(t.tokenStart);
    expect(t.lines.checkpointOffset).toBe(9);
  });

  it('counts lines past text the buffer has dropped', () => {
    const t = tokenizer(['<a>\n\r\n\r', 'xyz', '<b/></a>']);
    nth(t, 2);
    expect(t.bufferOffset).toBeGreaterThan(0);
    expect(t.lines.locationAt(t.tokenStart)).toEqual({ line: 4, column: 4, offset: 10 });
  });
});

describe('scan errors, at the offset of the fault', () => {
  it.each([
    ['< at the end', '<a>x<', 'WF_UNEXPECTED_END @4'],
    ['<! not followed by --, [CDATA[ or DOCTYPE', '<!x><a/>', 'WF_MARKUP @0'],
    ['a short <! at the end', '<a><!-', 'WF_MARKUP @3'],
    ['lower-case doctype', '<!doctype a><a/>', 'WF_MARKUP @0'],
    ['a name that starts with a digit', '<1/>', 'WF_NAME @1'],
    ['a start tag cut short', '<a', 'WF_UNEXPECTED_END @2'],
    ['/ at the end of a start tag', '<a/', 'WF_UNEXPECTED_END @2'],
    ['/ not followed by >', '<a/ >', 'WF_TAG @2'],
    ['no whitespace between attributes', '<a b="1"c="2"/>', 'WF_TAG @8'],
    ['no attribute name', '<a =x/>', 'WF_TAG @3'],
    ['an attribute without a value', '<a b>', 'WF_ATTRIBUTE @4'],
    ['an attribute cut short', '<a b', 'WF_UNEXPECTED_END @4'],
    ['an unquoted value', '<a b=1/>', 'WF_ATTRIBUTE @5'],
    ['= at the end', '<a b= ', 'WF_UNEXPECTED_END @6'],
    ['an unterminated value', '<a b="1', 'WF_UNEXPECTED_END @6'],
    ['< in a value', '<a b="<"/>', 'WF_LT_IN_ATTRIBUTE @6'],
    ['& alone in a value', '<a b="&"/>', 'WF_REFERENCE @6'],
    ['a reference without ; in a value', '<a b="&e"/>', 'WF_REFERENCE @8'],
    ['an end tag without a name', '<a></>', 'WF_NAME @5'],
    ['whitespace before the end tag name', '<a></ a>', 'WF_NAME @5'],
    ['an end tag cut short', '<a></a', 'WF_UNEXPECTED_END @6'],
    ['an end tag cut short after whitespace', '<a></a ', 'WF_UNEXPECTED_END @7'],
    ['an end tag cut short after a non-ASCII name', '<a></é', 'WF_UNEXPECTED_END @6'],
    ['something else in an end tag', '<a></a x>', 'WF_TAG @7'],
    ['<? at the end', '<a><?', 'WF_PI @5'],
    ['a PI target that starts with a digit', '<?1?><a/>', 'WF_PI @2'],
    ['a PI cut short after its target', '<a><?pi', 'WF_UNEXPECTED_END @7'],
    ['no whitespace after the PI target', '<a><?pi?x?></a>', 'WF_PI @7'],
    ['an unterminated PI', '<a><?pi x', 'WF_UNEXPECTED_END @8'],
    ['the XML declaration after the start', '<a><?xml version="1.0"?></a>', 'WF_XML_DECLARATION_MISPLACED @3'],
    ['a PI target xml in another case', '<a><?XmL?></a>', 'WF_PI_TARGET_XML @3'],
    ['an unterminated comment', '<a><!-- x', 'WF_UNEXPECTED_END @3'],
    ['a comment cut short after --', '<a><!-- x --', 'WF_UNEXPECTED_END @10'],
    ['-- inside a comment', '<a><!-- a -- b --></a>', 'WF_COMMENT @10'],
    ['<!---> taken as an unterminated comment', '<a><!---></a>', 'WF_UNEXPECTED_END @3'],
    ['an unterminated CDATA section', '<a><![CDATA[x', 'WF_UNEXPECTED_END @3'],
    ['<!DOCTYPE at the end', '<!DOCTYPE', 'WF_DOCTYPE @9'],
    ['no whitespace after <!DOCTYPE', '<!DOCTYPEa><a/>', 'WF_DOCTYPE @9'],
    ['no DOCTYPE name', '<!DOCTYPE ><a/>', 'WF_DOCTYPE @10'],
    ['a DOCTYPE cut short after its name', '<!DOCTYPE a', 'WF_UNEXPECTED_END @11'],
    ['something else after the DOCTYPE name', '<!DOCTYPE a x><a/>', 'WF_DOCTYPE @12'],
    ['no whitespace before a system literal', '<!DOCTYPE a SYSTEM"x"><a/>', 'WF_DOCTYPE @18'],
    ['no system literal', '<!DOCTYPE a SYSTEM><a/>', 'WF_DOCTYPE @18'],
    ['an unquoted system literal', '<!DOCTYPE a SYSTEM x><a/>', 'WF_DOCTYPE @19'],
    ['SYSTEM at the end', '<!DOCTYPE a SYSTEM ', 'WF_UNEXPECTED_END @19'],
    ['an unterminated literal', '<!DOCTYPE a SYSTEM "x', 'WF_UNEXPECTED_END @19'],
    ['PUBLIC with one literal', '<!DOCTYPE a PUBLIC "x"><a/>', 'WF_DOCTYPE @22'],
    ['{ in a public identifier', '<!DOCTYPE a PUBLIC "a{b" "x"><a/>', 'WF_DOCTYPE @18'],
    ['a tab in a public identifier', '<!DOCTYPE a PUBLIC "a\tb" "x"><a/>', 'WF_DOCTYPE @18'],
    ['" in a public identifier', '<!DOCTYPE a PUBLIC \'a"b\' "x"><a/>', 'WF_DOCTYPE @18'],
    ['an unterminated internal subset', '<!DOCTYPE a [', 'WF_UNEXPECTED_END @13'],
    ['text in the internal subset', '<!DOCTYPE a [x]><a/>', 'WF_DOCTYPE @13'],
    ['a parameter entity reference without ;', '<!DOCTYPE a [%p]><a/>', 'WF_DOCTYPE @15'],
    ['a parameter entity reference cut short', '<!DOCTYPE a [%p', 'WF_UNEXPECTED_END @15'],
    ['% without a name', '<!DOCTYPE a [% p;]><a/>', 'WF_DOCTYPE @14'],
    ['an element in the internal subset', '<!DOCTYPE a [<x>]><a/>', 'WF_DOCTYPE @13'],
    ['a conditional section in the internal subset', '<!DOCTYPE a [<![INCLUDE[]]>]><a/>', 'WF_DOCTYPE @13'],
    ['< at the end of the internal subset', '<!DOCTYPE a [<', 'WF_DOCTYPE @13'],
    ['an unterminated PI in the internal subset', '<!DOCTYPE a [<?pi x', 'WF_UNEXPECTED_END @13'],
    ['an unterminated comment in the internal subset', '<!DOCTYPE a [<!-- x', 'WF_UNEXPECTED_END @13'],
    ['a subset comment cut short after --', '<!DOCTYPE a [<!-- x --', 'WF_UNEXPECTED_END @20'],
    ['-- in a comment in the internal subset', '<!DOCTYPE a [<!-- a -- b -->]><a/>', 'WF_COMMENT @20'],
    ['an unterminated declaration', '<!DOCTYPE a [<!ENTITY e "x"', 'WF_UNEXPECTED_END @15'],
    ['a control character in a declaration', '<!DOCTYPE a [<!ENTITY e "\u0001">]><a/>', 'WF_INVALID_CHARACTER @25'],
    ['something else after the internal subset', '<!DOCTYPE a [] x><a/>', 'WF_DOCTYPE @15'],
    ['a DOCTYPE cut short after the internal subset', '<!DOCTYPE a []', 'WF_UNEXPECTED_END @14'],
    ['a DOCTYPE cut short after its literal', '<!DOCTYPE a SYSTEM "x"', 'WF_UNEXPECTED_END @22'],
    ['& at the end', '<a>&', 'WF_REFERENCE @3'],
    ['& alone', '<a>& </a>', 'WF_REFERENCE @3'],
    ['a reference cut short', '<a>&amp', 'WF_UNEXPECTED_END @3'],
    ['a reference without ;', '<a>&amp </a>', 'WF_REFERENCE @7'],
    ['&# at the end', '<a>&#', 'WF_UNEXPECTED_END @3'],
    ['a character reference cut short', '<a>&#12', 'WF_UNEXPECTED_END @3'],
    ['&#; with no digits', '<a>&#;</a>', 'WF_CHARACTER_REFERENCE @3'],
    ['&#x; with no digits', '<a>&#x;</a>', 'WF_CHARACTER_REFERENCE @3'],
    ['a letter after decimal digits', '<a>&#12a;</a>', 'WF_CHARACTER_REFERENCE @3'],
    ['an upper-case X (§4.1 [66])', '<a>&#X41;</a>', 'WF_CHARACTER_REFERENCE @3'],
    ['a value far above U+10FFFF', '<a>&#99999999999999;</a>', 'WF_CHARACTER_REFERENCE @3'],
    [']]> in text', '<a>x]]></a>', 'WF_CDATA_END_IN_TEXT @4'],
  ])('rejects %s', (_, xml, error) => {
    expect(tokens([xml]).at(-1)).toBe(error);
  });

  it('decodes upper- and lower-case hexadecimal digits and leading zeros (§4.1 [66])', () => {
    expect(tokens(['<a>&#xAbC;&#x00041;&#00065;</a>'])).toEqual(['<a>', 'text "&#xAbC;&#x00041;&#00065;"', '</a>']);
  });
});
