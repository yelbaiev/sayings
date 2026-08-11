import type { Currency, RateSource } from "@shared/currency";

/**
 * What a rate source has to provide, and nothing more.
 *
 * Two exist — the National Bank of Ukraine and the ECB — because neither can serve everyone: the ECB
 * publishes no hryvnia rate, and NBU is not a sensible primary for a household in Portugal. That is a
 * fact about the world rather than a design choice, so the shape of this interface is the design
 * choice: each source answers only "what is one unit of X worth in my own pivot currency, on this
 * date", and the resolver does the arithmetic.
 *
 * Keeping conversion out of the adapters means a third source is one file with no cross-rating logic
 * to get wrong, and it means the arithmetic is tested once rather than per source.
 */
export interface RateAdapter {
  readonly source: RateSource;
  /** The currency this source quotes everything against. */
  readonly pivot: Currency;
  /**
   * Pivot units per one unit of each requested currency, for one date.
   *
   * A currency the source does not publish is simply absent from the map rather than an error: one
   * missing currency must not cost the whole day's fetch.
   */
  fetch(iso: string, quotes: Currency[]): Promise<Map<Currency, number>>;
}

export class FxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxError";
  }
}
