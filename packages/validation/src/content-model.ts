/**
 * An element type's content model (§3.2), compiled for checking its children: `EMPTY`, `ANY`, mixed
 * content such as `(#PCDATA|em)*`, or element content such as `(title, para+)`, as an automaton.
 */
export type ContentModel =
  | { readonly kind: 'EMPTY' }
  | { readonly kind: 'ANY' }
  /** The element types allowed among the text, and one that is listed twice, which is a validity error. */
  | { readonly kind: 'MIXED'; readonly names: ReadonlySet<string>; readonly duplicate: string | undefined }
  | { readonly kind: 'CHILDREN'; readonly automaton: Automaton };

/** A parsed content particle: a name, or a sequence or choice, with its repetition. */
type Particle =
  | { readonly kind: 'name'; readonly name: string; readonly repeat: string }
  | { readonly kind: ',' | '|'; readonly children: readonly Particle[]; readonly repeat: string };

/** Compiles a content model from its text as the DTD parser keeps it: as written, without whitespace. */
export function compileContentModel(content: string): ContentModel {
  if (content === 'EMPTY' || content === 'ANY') return { kind: content };
  if (content.startsWith('(#PCDATA')) {
    const names = content.replace(/^\(#PCDATA\|?/, '').replace(/\)\*?$/, '');
    const list = names === '' ? [] : names.split('|');
    const set = new Set(list);
    const duplicate = list.find((name, i) => list.indexOf(name) !== i);
    return { kind: 'MIXED', names: set, duplicate };
  }
  const parser = new ParticleParser(content);
  return { kind: 'CHILDREN', automaton: new Automaton(parser.particle()) };
}

/** The characters that end a name in a content model: separators, parentheses and repetitions. */
const NAME_END = '|,()?*+';

/** Reads the content particles of an element-content model, such as `(title,para+)`, from its text. */
class ParticleParser {
  readonly #text: string;
  #pos = 0;

  constructor(text: string) {
    this.#text = text;
  }

  /** A content particle: a name, or a choice or sequence in parentheses, with its repetition. */
  particle(): Particle {
    return this.#text[this.#pos] === '(' ? this.#readGroup() : this.#readName();
  }

  /** An element type's name and its repetition. */
  #readName(): Particle {
    const text = this.#text;
    const start = this.#pos;
    while (this.#pos < text.length && !NAME_END.includes(text[this.#pos] as string)) this.#pos++;
    return { kind: 'name', name: text.slice(start, this.#pos), repeat: this.#readRepetition() };
  }

  /** A choice or sequence: its particles between parentheses, then its repetition. */
  #readGroup(): Particle {
    const text = this.#text;
    this.#pos++;
    const children = [this.particle()];
    let kind: ',' | '|' = ',';
    while (text[this.#pos] === ',' || text[this.#pos] === '|') {
      kind = text[this.#pos] as ',' | '|';
      this.#pos++;
      children.push(this.particle());
    }
    this.#pos++;
    return { kind, children, repeat: this.#readRepetition() };
  }

  /** A repetition, `?`, `*` or `+`, or the empty string for none. */
  #readRepetition(): string {
    const char = this.#text[this.#pos];
    if (char !== '?' && char !== '*' && char !== '+') return '';
    this.#pos++;
    return char;
  }
}

/** What the automaton needs to know of a particle: the positions it can start and end with, and whether it can match nothing. */
interface ParticlePositions {
  /** Whether it can match no children at all, as `a?` and `a*` can. */
  readonly nullable: boolean;
  /** The positions a match can start with. */
  readonly first: readonly number[];
  /** The positions a match can end with. */
  readonly last: readonly number[];
}

/** The state before any child, whose positions are the model's first ones. */
const START = 0;

/** What `next` gives for a child the model does not allow. */
const REJECTED = -1;

/**
 * Checks a sequence of child elements against an element-content model, one child at a time.
 *
 * Each element name written in the model is a position: in `(a, b*, a)` there are three, the two
 * `a`s apart. The automaton works out which positions can come first, which can follow each one,
 * and which can come last (a Glushkov automaton). Reading the children then means keeping the set
 * of positions the children so far can have reached; a child is allowed if one of the positions
 * that can follow is its name. Each set of positions met is numbered as a state the first time,
 * with its transitions cached, so each later document with the same model reads in constant time
 * per child.
 */
export class Automaton {
  /** The element name at each position. */
  readonly #names: string[] = [];
  /** The positions that can follow each position. */
  readonly #follow: Set<number>[] = [];
  /** The positions a match can start with. */
  readonly #first: readonly number[];
  /** The positions a match can end with. */
  readonly #lastPositions: ReadonlySet<number>;
  /** Whether the model allows no children at all. */
  readonly #nullable: boolean;
  /** The states found so far: each one's set of positions, by state number. */
  readonly #states: (readonly number[])[] = [];
  /** Each state's transitions found so far: the state after a child of each name. */
  readonly #transitions: Map<string, number>[] = [];
  /** The state numbers by their positions, written as a key such as `0,2`. */
  readonly #stateByPositions = new Map<string, number>();

  constructor(root: Particle) {
    const positions = this.#addParticle(root);
    this.#first = positions.first;
    this.#lastPositions = new Set(positions.last);
    this.#nullable = positions.nullable;
    this.#states.push([]);
    this.#transitions.push(new Map());
  }

  /** The state before any child. */
  get start(): number {
    return START;
  }

  /** The state after a child of this name, or REJECTED (-1) when the model does not allow it there. */
  next(state: number, name: string): number {
    const transitions = this.#transitions[state] as Map<string, number>;
    const known = transitions.get(name);
    if (known !== undefined) return known;
    const candidates = this.#nextPositions(state);
    const positions = candidates.filter((position) => this.#names[position] === name).toSorted((a, b) => a - b);
    const target = positions.length === 0 ? REJECTED : this.#stateFor(positions);
    transitions.set(name, target);
    return target;
  }

  /** Whether the children so far make a complete match. */
  accepts(state: number): boolean {
    if (state === START) return this.#nullable;
    return (this.#states[state] as readonly number[]).some((position) => this.#lastPositions.has(position));
  }

  /** The names the model allows next, for error messages. */
  expected(state: number): string[] {
    return [...new Set(this.#nextPositions(state).map((position) => this.#names[position] as string))];
  }

  /** The positions that can come next in a state. */
  #nextPositions(state: number): readonly number[] {
    return state === START ? this.#first : this.#followAll(this.#states[state] as readonly number[]);
  }

  /** The positions that can follow any of the given ones. */
  #followAll(positions: readonly number[]): number[] {
    const following = new Set<number>();
    for (const position of positions) for (const next of this.#follow[position] as Set<number>) following.add(next);
    return [...following];
  }

  /** The state for a set of positions, numbered when first found. */
  #stateFor(positions: readonly number[]): number {
    const key = positions.join(',');
    let state = this.#stateByPositions.get(key);
    if (state === undefined) {
      state = this.#states.length;
      this.#states.push(positions);
      this.#transitions.push(new Map());
      this.#stateByPositions.set(key, state);
    }
    return state;
  }

  /** Numbers a particle's names as positions, adds which can follow which inside it, and returns its positions. */
  #addParticle(particle: Particle): ParticlePositions {
    let positions: ParticlePositions;
    if (particle.kind === 'name') {
      const position = this.#names.length;
      this.#names.push(particle.name);
      this.#follow.push(new Set());
      positions = { nullable: false, first: [position], last: [position] };
    } else {
      const children = particle.children.map((child) => this.#addParticle(child));
      positions = particle.kind === '|' ? choice(children) : this.#sequence(children);
    }
    return this.#applyRepetition(positions, particle.repeat);
  }

  /** A sequence's positions, adding which of its children's positions can follow which. */
  #sequence(children: readonly ParticlePositions[]): ParticlePositions {
    for (let i = 0; i < children.length - 1; i++) this.#followFrom(children, i);
    const reversed = children.toReversed();
    return {
      nullable: children.every((child) => child.nullable),
      first: throughNullable(children, (child) => child.first),
      last: throughNullable(reversed, (child) => child.last),
    };
  }

  /** Lets child `i`'s last positions be followed by the next child's first, and by later ones past nullable children. */
  #followFrom(children: readonly ParticlePositions[], i: number): void {
    const last = (children[i] as ParticlePositions).last;
    for (let j = i + 1; j < children.length; j++) {
      const next = children[j] as ParticlePositions;
      for (const position of last) for (const following of next.first) this.#follow[position]?.add(following);
      if (!next.nullable) return;
    }
  }

  /** A particle's positions after its repetition: `*` and `+` let its last positions loop back to its first. */
  #applyRepetition(positions: ParticlePositions, repeat: string): ParticlePositions {
    if (repeat === '*' || repeat === '+') {
      for (const position of positions.last) for (const first of positions.first) this.#follow[position]?.add(first);
    }
    return repeat === '?' || repeat === '*' ? { ...positions, nullable: true } : positions;
  }
}

/** The positions of children taken in order up to and including the first that cannot match nothing. */
function throughNullable(
  children: readonly ParticlePositions[],
  positionsOf: (child: ParticlePositions) => readonly number[]
): number[] {
  const positions: number[] = [];
  for (const child of children) {
    positions.push(...positionsOf(child));
    if (!child.nullable) break;
  }
  return positions;
}

/** A choice's positions: any child's. */
function choice(children: readonly ParticlePositions[]): ParticlePositions {
  return {
    nullable: children.some((child) => child.nullable),
    first: children.flatMap((child) => child.first),
    last: children.flatMap((child) => child.last),
  };
}
