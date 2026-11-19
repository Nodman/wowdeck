import { ValidationError } from "../errors";
import type { GameRunning, LaunchClient, LaunchCompletion, LaunchState, MethodMap } from "../../api/contracts";

export interface LaunchEntry {
  appId: number;
  clients: LaunchClient[];
  target: LaunchClient;
  /** The target client's flavor folder; absent for Battle.net. */
  targetDirectory?: string;
  /** The product code Battle.net is asked to launch; absent for Battle.net. */
  product?: string;
  prefixes: string[];
  libraries: string[];
}

export interface Observation {
  entryRunning: boolean;
  renderer: number | null;
  gameRunning: GameRunning;
  targetRunning: boolean;
  replay?: Replay;
}

export interface Replay {
  reaperPid: number;
  prefix: string;
  argv: string[];
  env: Record<string, string>;
}

export interface LaunchWorld {
  now(): number;
  wait(): Promise<void>;
  observe(entry: LaunchEntry): Promise<Observation>;
  ask(replay: Replay | undefined): Promise<{ startupFailed: Promise<boolean> } | null>;
}

interface LaunchAttempt {
  entry: LaunchEntry;
  steamStart?: { gameId: string; attemptId: string };
  steamRefused: boolean;
}

const WINDOW = 150_000;
const ASK_INTERVAL = 15_000;
const READY_DELAY = 5_000;
const MAX_ASKS = 3;

function validAppId(appId: number): boolean {
  return Number.isInteger(appId) && appId > 0 && appId <= 0xffffffff;
}

export class LaunchService {
  private active: LaunchAttempt | null = null;

  constructor(
    private readonly resolve: (appId: number, preferredId?: string) => Promise<LaunchEntry | null>,
    private readonly world: LaunchWorld,
    private readonly completed: (completion: LaunchCompletion) => void,
  ) {}

  private async entry(appId: number): Promise<LaunchEntry | null> {
    return validAppId(appId) ? this.resolve(appId) : null;
  }

  private snapshot(entry: LaunchEntry, observed: Observation): LaunchState {
    return {
      clients: entry.clients,
      target: entry.target,
      entryRunning: observed.entryRunning,
      gameRunning: observed.gameRunning,
      busy: this.active !== null,
    };
  }

  async select(appId: number, targetId: string, save: (target: LaunchClient) => void): Promise<LaunchClient> {
    const entry = validAppId(appId) && typeof targetId === "string"
      ? await this.resolve(appId, targetId)
      : null;
    if (!entry || entry.target.id !== targetId || !entry.target.launchable) {
      throw new ValidationError("This client can't be launched from this Steam game page");
    }
    save(entry.target);
    return entry.target;
  }

  async state(appId: number): Promise<LaunchState | null> {
    // A pending attempt keeps its original entry while the page shows the
    // target chosen for the next launch.
    const entry = await this.entry(appId);
    return entry ? this.snapshot(entry, await this.world.observe(entry)) : null;
  }

  async start(
    appId: number,
    canStartSteam = false,
    steamEntryRunning = false,
  ): Promise<MethodMap["launch.start"]["result"]> {
    const entry = await this.entry(appId);
    if (!entry) return { state: null };
    const observed = await this.world.observe(entry);
    const alreadyStarted = observed.entryRunning || steamEntryRunning;
    if (this.active || !entry.target.launchable || observed.gameRunning !== "not_running" ||
        (!alreadyStarted && !canStartSteam) ||
        // A running entry already is Battle.net open: nothing to start.
        (alreadyStarted && entry.target.kind === "battlenet")) {
      return { state: this.snapshot(entry, observed) };
    }

    const steamStart = alreadyStarted ? undefined : {
      gameId: ((BigInt(appId) << 32n) | 0x02000000n).toString(),
      attemptId: crypto.randomUUID(),
    };
    const attempt = { entry, steamStart, steamRefused: false };
    this.active = attempt;
    void this.run(attempt, observed);
    return { state: this.snapshot(entry, observed), steamStart };
  }

  steamRefused(attemptId: string): void {
    if (this.active?.steamStart?.attemptId === attemptId) this.active.steamRefused = true;
  }

  private async run(attempt: LaunchAttempt, initial: Observation): Promise<void> {
    const { entry } = attempt;
    let outcome: LaunchCompletion["outcome"] = "ask-failed";
    try {
      outcome = await this.attempt(attempt, initial);
    } catch {
      // Process and spawn errors can contain environment, paths and argv.
      console.error(JSON.stringify({ component: "launch", event: "attempt-failed" }));
    } finally {
      this.active = null;
      this.completed({ appId: entry.appId, clientName: entry.target.shortName, outcome });
    }
  }

  private async attempt(attempt: LaunchAttempt, observed: Observation): Promise<LaunchCompletion["outcome"]> {
    const started = this.world.now();
    let lastAsk = started;
    let renderer = observed.renderer;
    let readySince = started;
    let asks = 0;
    let failedAsks = 0;
    let entrySeen = observed.entryRunning;
    // Battle.net is Steam's own launch: the entry running is the whole job.
    const battleNet = attempt.entry.target.kind === "battlenet";

    for (;;) {
      const now = this.world.now();
      if (observed.targetRunning || (battleNet && observed.entryRunning)) return "confirmed";
      if (observed.gameRunning === "running") return "unconfirmed";
      entrySeen ||= observed.entryRunning;
      if (!asks && attempt.steamRefused) return "steam-refused";
      if (now - started >= WINDOW || (entrySeen && !observed.entryRunning)) {
        if (!asks) return "never-ready";
        return failedAsks === asks ? "ask-failed" : "unconfirmed";
      }

      if (observed.renderer !== renderer) {
        renderer = observed.renderer;
        readySince = now;
      }
      if (!battleNet && observed.entryRunning && renderer !== null && observed.gameRunning === "not_running" && asks < MAX_ASKS &&
          now - readySince >= READY_DELAY && now - lastAsk >= ASK_INTERVAL) {
        const replay = await this.world.ask(observed.replay);
        if (!replay) {
          if (!asks) return "ask-failed";
          failedAsks++;
        } else {
          void replay.startupFailed.then((failed) => {
            if (failed) failedAsks++;
          }, () => {
            // A failed diagnostic read leaves delivery uncertain.
          });
        }
        asks++;
        lastAsk = now;
      }

      await this.world.wait();
      observed = await this.world.observe(attempt.entry);
    }
  }
}
