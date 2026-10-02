/** Permission callbacks can precede or follow Electron's display selector.
 * This lease authorizes only one selector result for one trusted frame, never a default screen.
 * The short completed phase permits a late Chromium permission callback but cannot capture twice.
 */
export interface CaptureTicket {
  readonly id: string;
  readonly frame: string;
  readonly serial: number;
}
interface Lease extends CaptureTicket {
  expiresAt: number;
  phase: "pending" | "handling" | "completed";
  requested: boolean;
}
export class DisplayCaptureGrant {
  private lease?: Lease;
  private serial = 0;
  constructor(
    private readonly enabled: boolean,
    private readonly clock: () => number = () => performance.now(),
  ) {}
  select(id: string, frame: string): void {
    if (!this.enabled)
      throw new Error("Desktop capture is disabled in test mode");
    this.lease = {
      id,
      frame,
      serial: ++this.serial,
      expiresAt: this.clock() + 15_000,
      phase: "pending",
      requested: false,
    };
  }
  revoke(): void {
    this.lease = undefined;
    this.serial += 1;
  }
  private current(frame: string): Lease | undefined {
    if (
      !this.enabled ||
      !this.lease ||
      this.lease.frame !== frame ||
      this.clock() >= this.lease.expiresAt
    )
      return undefined;
    return this.lease;
  }
  check(frame: string): boolean {
    return !!this.current(frame);
  }
  request(frame: string): boolean {
    const lease = this.current(frame);
    if (!lease || lease.requested) return false;
    lease.requested = true;
    return true;
  }
  begin(frame: string): CaptureTicket | undefined {
    const lease = this.current(frame);
    if (!lease || lease.phase !== "pending") return undefined;
    lease.phase = "handling";
    return { id: lease.id, frame: lease.frame, serial: lease.serial };
  }
  complete(ticket: CaptureTicket, success: boolean): boolean {
    const lease = this.current(ticket.frame);
    if (
      !lease ||
      lease.serial !== ticket.serial ||
      lease.id !== ticket.id ||
      lease.phase !== "handling"
    )
      return false;
    if (!success) {
      this.revoke();
      return false;
    }
    lease.phase = "completed";
    lease.expiresAt = Math.min(lease.expiresAt, this.clock() + 2000);
    return true;
  }
}
