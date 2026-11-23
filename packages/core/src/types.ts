// The core's data: what it reads (Vocabulary, GenerationRequest) and what it produces. Every shape
// here is JSON-serializable and mirrors a definition in schema/oosem.schema.json; a change to one
// is a change to the other.

/** The names of one phase in the method library. */
export interface PhaseNames {
  concept: string;     // 'Blackbox'
  collection: string;  // 'blackboxes'
  metadata: string;    // 'BlackboxMetadata'
  keyword: string;     // 'blackbox', the metadata definition's short name
  suffix: string;      // '_bb', for default names
  label: string;       // 'Blackbox', in UI texts
}

/** Every library name the core uses; names are unescaped. */
export interface Vocabulary {
  root: string;              // the library's root package
  conceptsPackage: string;
  metadataPackage: string;
  blackbox: PhaseNames;
  graybox: PhaseNames;
  whitebox: PhaseNames;
}

/** A partial vocabulary, as a vocabulary file holds it: missing keys fall back to the defaults. */
export type PartialVocabulary = Partial<Omit<Vocabulary, 'blackbox' | 'graybox' | 'whitebox'>> & {
  blackbox?: Partial<PhaseNames>;
  graybox?: Partial<PhaseNames>;
  whitebox?: Partial<PhaseNames>;
};

export type Phase = 'blackbox' | 'graybox' | 'whitebox';

/** The method's extensions beyond plain OOSEM; both are off by default. */
export interface Extensions {
  properties: boolean;             // a blackbox's blackbox-phase features are properties, refined down the phases
  inPhaseSpecialization: boolean;  // a block may specialize a block of its own phase (still an R3 error in this version)
}

/** An element: its id in the model, and its qualified name (null where KerML gives none). */
export interface ElementRef {
  id: string;
  qualifiedName: string | null;
}

export type Rule = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R11' | 'R12' | 'R13';

export interface Finding {
  rule: Rule;
  severity: 'error' | 'warning';
  target: ElementRef;
  block: string;             // the id of the block it concerns; for R10 on a feature, the whitebox
  message: string;
  related?: ElementRef[];    // e.g. the parent named in R3, the cycle in R4
}

/** What a feature is to the block that holds it. */
export type FeatureRole = 'property' | 'subsystem' | 'choice' | 'untracked' | 'misplaced';

export interface Multiplicity {
  lower: number;
  upper: number | null;      // null: unbounded (*)
}

/** A feature a block holds, owned or inherited. */
export interface FeatureInfo {
  ref: ElementRef;           // the declaration; for an inherited feature, the original one
  name: string | null;       // its declared name, else the name of what it redefines
  keyword: string;           // its SysML keyword: 'part', 'item', 'port', 'ref', …; '' for a bare usage
  role: FeatureRole;
  phase: Phase | null;       // null: none
  types: ElementRef[];       // its written typings
  redefines: ElementRef | null;      // the held feature it replaces (a choice's subsystem)
  inheritedFrom: string | null;      // the id of the block it was copied from; null if owned
  multiplicity: Multiplicity | null; // null: not written
}

export interface BlockInfo {
  ref: ElementRef;
  name: string;              // its declared name
  keyword: string;           // its SysML keyword: 'part', 'item', 'port', 'occurrence', …
  phase: Phase;
  library: boolean;          // inside a library package other than the method library
  passes: boolean;           // neither it nor its features have an error or a warning
  features: FeatureInfo[];
}

export type EdgeKind = 'phase' | 'inPhase' | 'decomposes' | 'realizes';

/** A graph edge between blocks, by id. */
export interface Edge {
  kind: EdgeKind;
  from: string;
  to: string;
  usage?: ElementRef;        // decomposes and realizes: the subsystem usage
}

export interface Analysis {
  schemaVersion: 1;
  vocabulary: Vocabulary;
  extensions: Extensions;
  libraryFound: boolean;     // the vocabulary's root package resolves
  blocks: BlockInfo[];
  edges: Edge[];
  findings: Finding[];
  usageStyleBoxes: ElementRef[];
}

/** The dashboard as data: layout, rows, lines and badges. Selection,
 * highlighting and the "Show" menu are the UI's, over the analysis's edges. */
export interface DashboardModel {
  schemaVersion: 1;
  libraryFound: boolean;
  columns: [DashboardColumn, DashboardColumn, DashboardColumn];
  blocks: Record<string, DashboardBlock>;    // by block id
  notice: { message: string; usages: ElementRef[] } | null;  // the usage-style boxes
}

export interface DashboardColumn {
  phase: Phase;
  label: string;             // 'Blackbox'
  groups: DashboardGroup[];
}

/** A group of rows: all blackboxes, the blocks under one parent, or a column's orphans. */
export interface DashboardGroup {
  title: string | null;      // 'Grayboxes of Quadcopter_bb', 'Orphan grayboxes'; null for the blackboxes
  parent: string | null;     // the parent block's id
  orphans: boolean;          // carries an error badge when it has rows
  rows: string[];            // block ids
}

export interface DashboardBlock {
  ref: ElementRef;
  name: string;
  phase: Phase;
  library: boolean;
  errors: string[];          // the messages of its own and its features' errors
  warnings: string[];
  lines: DashboardLine[];
  untracked: number;         // "{n} untracked features"
}

/** One selectable line under an expanded row. */
export interface DashboardLine {
  kind: 'usedIn' | 'subsystem' | 'choice' | 'unintegrated';
  text: string;              // 'Quadcopter_gb.airframe', 'airframe : Airframe_bb', 'airframe :>> airframe : Airframe_wb'
  usage: ElementRef;         // the usage the line stands for
  owner: string;             // the id of the block that holds the usage
  target: string | null;     // the id of the block the line refers to, where it jumps
  redefines: ElementRef | null;  // a choice's subsystem
  inherited: boolean;
}

/** How a whitebox fills one inherited subsystem. */
export type SubsystemChoice =
  | { realizeWith: string }  // qualified name of a graybox or whitebox that specializes the usage's type
  | { unintegrated: true }   // write nothing for this usage
  | { stub: string };        // the name of a new graybox stub, generated in the same package

export interface GenerationRequest {
  kind: 'graybox' | 'whitebox';
  subject: string;           // qualified name of the blackbox (graybox) or graybox (whitebox)
  name: string;              // the new block's name; also the package's and the file's
  folder: string;            // workspace-relative folder of the new file
  subsystems?: { usage: string; choice: SubsystemChoice; newName?: string }[];  // whitebox only; every inherited subsystem exactly once
}

export type GenerationResult =
  | { ok: true; unit: string; text: string; newBlocks: string[] }  // unit = folder/name.sysml
  | { ok: false; problems: string[] };
