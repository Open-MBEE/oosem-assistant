// The only module that reads the SDK's Model. It reads what the model states,
// with the reads every backend answers, into plain data keyed by element id.

import { is, NotImplementedInToolkit, UnresolvedReference } from 'sysml';
import type { AnyElement, Model } from 'sysml';
import type { ElementRef, Multiplicity } from './types.ts';

/** An element, as every fact holds it. */
export interface ElementFact {
  id: string;
  qualifiedName: string | null;
  name: string | null;         // the declared name
  metaclass: string;
  owner: string | null;        // the owning namespace's id
  library: boolean;            // isLibraryElement: inside a library package
  metadata: string[];          // the definitions typing its owned metadata usages
}

/** A type: a definition, or any other classifier. */
export interface TypeFact extends ElementFact {
  supertypes: string[];        // written superclassifiers
  features: string[];          // owned features, metadata usages left out, in order
  occurrenceDefinition: boolean;  // part, item, port, action, … definitions: what can be a block
}

export interface FeatureFact extends ElementFact {
  types: string[];             // written typings
  subsets: string[];           // written subsettings, redefinitions left out
  redefines: string[];         // written redefinitions
  multiplicity: Multiplicity | null;  // its own, with literal bounds; else null
  usage: boolean;              // a SysML usage (not a KerML feature, a connector end, …)
}

export interface Facts {
  elements: Map<string, ElementFact>;   // every element read, types and features included
  types: Map<string, TypeFact>;
  features: Map<string, FeatureFact>;
  /** The element a qualified name names, if it is in the model. */
  resolve(qualifiedName: string): string | null;
}

/** An element's id and qualified name, as the analysis reports it. */
export function refOf(fact: ElementFact): ElementRef {
  return { id: fact.id, qualifiedName: fact.qualifiedName };
}

export function readFacts(model: Model): Facts {
  const all = [...model.all()];
  const inModel = new Set(all.map((e) => e.$id));

  // The one place for references that do not resolve: a dangling reference, one outside the
  // model (the standard library, which a payload does not hold), or one to the wrong kind of
  // element (a package as a supertype: the SysML Toolkit refuses the read, a payload returns
  // the package) contributes nothing.
  const end = (read: () => AnyElement | null | undefined, kind: 'Classifier' | 'Type' | 'Feature' | 'Namespace'): string | null => {
    try {
      const element = read();
      return element && inModel.has(element.$id) && is(element, kind) ? element.$id : null;
    } catch (e) {
      if (e instanceof UnresolvedReference || e instanceof NotImplementedInToolkit) return null;
      throw e;
    }
  };
  const ends = <R extends { isImplied: boolean | null }>(
    relationships: readonly R[], target: (r: R) => AnyElement | null | undefined, kind: 'Classifier' | 'Type' | 'Feature',
  ) => relationships.filter((r) => !r.isImplied).map((r) => end(() => target(r), kind)).filter((id) => id !== null);

  const metadataOf = (element: AnyElement): string[] =>
    is(element, 'Namespace')
      ? element.ownedMember.filter((m) => is(m, 'MetadataUsage')).flatMap((m) => ends(m.ownedTyping, (t) => t.type, 'Type'))
      : [];

  const elements = new Map<string, ElementFact>();
  const types = new Map<string, TypeFact>();
  const features = new Map<string, FeatureFact>();

  // namespaces only: packages, types and features. Relationships are read through their ends; the
  // ones a backend implies (an export lists them, the SysML Toolkit's model does not) never count.
  for (const element of all) {
    if (!is(element, 'Namespace') || is(element, 'MetadataUsage')) continue;
    const base: ElementFact = {
      id: element.$id,
      qualifiedName: element.qualifiedName ?? null,
      name: element.declaredName ?? null,
      metaclass: element.$metaclass,
      owner: end(() => element.owningNamespace, 'Namespace'),
      library: element.isLibraryElement === true,
      metadata: metadataOf(element),
    };
    elements.set(base.id, base);
    if (is(element, 'Feature')) {
      const fact: FeatureFact = {
        ...base,
        types: ends(element.ownedTyping, (t) => t.type, 'Type'),
        subsets: ends(element.ownedSubsetting.filter((s) => !is(s, 'Redefinition')), (s) => s.subsettedFeature, 'Feature'),
        redefines: ends(element.ownedRedefinition, (r) => r.redefinedFeature, 'Feature'),
        multiplicity: multiplicityOf(element),
        usage: is(element, 'Usage'),
      };
      features.set(fact.id, fact);
      elements.set(fact.id, fact);
    } else if (is(element, 'Type')) {
      const fact: TypeFact = {
        ...base,
        supertypes: is(element, 'Classifier') ? ends(element.ownedSubclassification, (s) => s.superclassifier, 'Classifier') : [],
        features: element.ownedFeature.filter((f) => !is(f, 'MetadataUsage') && inModel.has(f.$id)).map((f) => f.$id),
        occurrenceDefinition: is(element, 'OccurrenceDefinition'),
      };
      types.set(fact.id, fact);
      elements.set(fact.id, fact);
    }
  }

  return {
    elements,
    types,
    features,
    resolve(qualifiedName) {
      try {
        const element = model.resolve(qualifiedName);
        return element && elements.has(element.$id) ? element.$id : null;
      } catch (e) {
        if (e instanceof UnresolvedReference || e instanceof NotImplementedInToolkit) return null;
        throw e;
      }
    },
  };
}

/** An element's name as the UI shows it: its declared name, else, for a feature, the name of what
 * it redefines (`part :>> airframe;` shows as airframe). */
export function displayName(facts: Facts, id: string): string | null {
  const seen = new Set<string>();
  for (let at: string | undefined = id; at !== undefined && !seen.has(at); at = facts.features.get(at)?.redefines[0]) {
    seen.add(at);
    const name = facts.elements.get(at)?.name;
    if (name != null) return name;
  }
  return null;
}

// a feature's own multiplicity with literal bounds (`[0..1]`, `[4]`, `[*]`); null when it writes
// none, or a bound is an expression
function multiplicityOf(feature: AnyElement & { multiplicity: AnyElement | null }): Multiplicity | null {
  const range = feature.multiplicity;
  if (!range || !is(range, 'MultiplicityRange')) return null;
  const value = (e: AnyElement | null): number | null | undefined => {
    if (e && is(e, 'LiteralInfinity')) return null;
    if (e && is(e, 'LiteralInteger')) return e.value;
    return undefined;
  };
  // one bound is the upper one, and the lower one too (`[4]`), except `[*]`, which is `[0..*]`
  const upper = value(range.upperBound);
  const lower = range.lowerBound != null ? value(range.lowerBound) : upper === null ? 0 : upper;
  if (upper === undefined || lower === undefined || lower === null) return null;
  return { lower, upper };
}

// metaclasses whose keyword is not their name
const KEYWORDS: Record<string, string> = {
  Calculation: 'calc', AnalysisCase: 'analysis', VerificationCase: 'verification', UseCase: 'use case', Reference: 'ref',
  Enumeration: 'enum', EventOccurrence: 'event occurrence', BindingConnectorAs: 'binding', SuccessionAs: 'succession',
  SuccessionFlow: 'succession flow', PerformAction: 'perform', ExhibitState: 'exhibit state', IncludeUseCase: 'include',
  SatisfyRequirement: 'satisfy', AssertConstraint: 'assert',
};

/** A definition's or a usage's SysML keyword from its metaclass: PartDefinition → 'part', ItemUsage →
 * 'item', UseCaseDefinition → 'use case', ReferenceUsage → 'ref'. */
export function keywordOf(metaclass: string): string {
  const stem = metaclass.replace(/(Definition|Usage)$/, '');
  return KEYWORDS[stem] ?? stem.charAt(0).toLowerCase() + stem.slice(1);
}
