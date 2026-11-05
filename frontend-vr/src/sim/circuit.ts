/**
 * Electrical model of the demo circuit (pure, unit-tested).
 *
 *   Battery 12 V (EMF 12.6 V, r = 0.3 Ω) ── switch ── 3 × 150 Ω in series ── 2 red LEDs in parallel
 *
 * Red LED: forward voltage ≈ 2.0 V, max continuous current 20 mA.
 *   With resistors:    I = (12.6 − 2.0) / (450 + 0.3) ≈ 23.5 mA → ≈ 11.8 mA per LED (OK)
 *   Without resistors: I = (12.6 − 2.0) / (0.3 + 0.2 wiring) ≈ 21 A → the LEDs burn out.
 */

export const EMF_V = 12.6;
export const INTERNAL_R = 0.3;
export const WIRING_R = 0.2;
export const RESISTOR_OHMS = 150;
export const RESISTOR_COUNT = 3;
export const LED_VF = 2.0;
export const LED_COUNT = 2;
export const LED_MAX_MA = 20;

export interface CircuitInput {
  boardPlaced: boolean;
  batteryPlaced: boolean;
  wiresPlaced: boolean;
  resistorsPlaced: boolean;
  ledsPlaced: boolean;
  switchOn: boolean;
  /** LEDs already destroyed earlier (latched by the caller). */
  ledsBurnt: boolean;
}

export interface CircuitState {
  /** Battery connected to the board (switch closed, wires in place). */
  powered: boolean;
  /** Current flows through the LEDs. */
  closed: boolean;
  current_mA: number;
  perLed_mA: number;
  /** Battery terminal voltage (V). */
  batteryVoltage: number;
  /** 0..1 visual brightness of each LED. */
  ledBrightness: number;
  /** True if this state destroys the LEDs (no current-limiting resistor). */
  burnsLeds: boolean;
}

/** Computes the circuit state (Ohm's law, ideal LEDs with a fixed forward voltage). */
export function computeCircuit(i: CircuitInput): CircuitState {
  const powered = i.switchOn && i.batteryPlaced && i.boardPlaced && i.wiresPlaced;
  const open: CircuitState = {
    powered,
    closed: false,
    current_mA: 0,
    perLed_mA: 0,
    batteryVoltage: EMF_V,
    ledBrightness: 0,
    burnsLeds: false,
  };
  if (!powered || !i.ledsPlaced || i.ledsBurnt) return open;

  const seriesR = i.resistorsPlaced ? RESISTOR_COUNT * RESISTOR_OHMS : 0;
  const current = (EMF_V - LED_VF) / (seriesR + INTERNAL_R + WIRING_R); // A
  const perLed = (current * 1000) / LED_COUNT;
  if (perLed > LED_MAX_MA * 5) {
    // Massive overcurrent: the LEDs die instantly and the circuit opens.
    return { ...open, burnsLeds: true };
  }
  return {
    powered,
    closed: true,
    current_mA: round1(current * 1000),
    perLed_mA: round1(perLed),
    batteryVoltage: round2(EMF_V - current * INTERNAL_R),
    ledBrightness: Math.min(1, perLed / LED_MAX_MA + 0.25),
    burnsLeds: false,
  };
}

/** French decimal formatting for the multimeter display ("23,5"). */
export function fr(n: number, digits: number): string {
  return n.toFixed(digits).replace(".", ",");
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
