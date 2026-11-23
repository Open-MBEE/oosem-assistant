// A loaded model and what the commands and `serve` do with it.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dashboard, defaultName, generate } from 'oosem';
import type { Analysis, DashboardModel, ElementRef, Finding, GenerationRequest, GenerationResult } from 'oosem';
import { discover, InputError } from './discover.ts';
import type { DiscoveryOptions, Inputs } from './discover.ts';
import { load } from './load.ts';
import type { LoadOptions } from './load.ts';

/** `oosem validate --json` and `serve`'s validate (schema: ValidationReport). */
export interface ValidationReport {
  schemaVersion: 1;
  libraryFound: boolean;
  findings: Finding[];
  usageStyleBoxes: ElementRef[];
}

export interface Settings {
  folder: string;
  discovery: DiscoveryOptions;
  load: LoadOptions;
}

export class Session {
  readonly settings: Settings;
  readonly inputs: Inputs;
  readonly analysis: Analysis;

  private constructor(settings: Settings, inputs: Inputs, analysis: Analysis) {
    this.settings = settings;
    this.inputs = inputs;
    this.analysis = analysis;
  }

  static async open(settings: Settings): Promise<Session> {
    const inputs = discover(settings.folder, settings.discovery);
    return new Session(settings, inputs, await load(inputs, settings.load));
  }

  /** The same settings, with the files found and read again. */
  reload(): Promise<Session> {
    return Session.open(this.settings);
  }

  validation(): ValidationReport {
    const { libraryFound, findings, usageStyleBoxes } = this.analysis;
    return { schemaVersion: 1, libraryFound, findings, usageStyleBoxes };
  }

  dashboard(): DashboardModel {
    return dashboard(this.analysis);
  }

  /** A default name; a name with a file `{name}.sysml` in `folder` is taken. */
  defaultName(kind: 'graybox' | 'whitebox' | 'stub', of: string, folder = ''): string {
    const dir = this.inside(folder);
    try {
      return defaultName(this.analysis, kind, of, (name) => existsSync(path.join(dir, `${name}.sysml`)));
    } catch (e) {
      if (e instanceof RangeError) throw new InputError(e.message);
      throw e;
    }
  }

  /** Generation; with `write`, the new file under the root, never over an existing one. */
  generate(request: GenerationRequest, write: boolean): { generation: GenerationResult; written: string | null } {
    const dir = this.inside(request.folder);
    const generation = generate(this.analysis, request, {
      unitExists: (unit) => existsSync(path.join(this.inputs.root, unit)),
      fileTaken: (name) => existsSync(path.join(dir, `${name}.sysml`)),
    });
    if (!write || !generation.ok) return { generation, written: null };
    const file = path.join(this.inputs.root, generation.unit);
    mkdirSync(path.dirname(file), { recursive: true });
    try {
      writeFileSync(file, generation.text, { flag: 'wx' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        return { generation: { ok: false, problems: [`${generation.unit} exists; it is not overwritten.`] }, written: null };
      }
      throw e;
    }
    return { generation, written: file };
  }

  /** A folder relative to the root, which must stay inside it. */
  private inside(folder: string): string {
    const dir = path.resolve(this.inputs.root, folder);
    const rel = path.relative(this.inputs.root, dir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new InputError(`the folder ${folder} is outside ${this.inputs.root}`);
    return dir;
  }
}
