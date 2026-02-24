import axios from "axios";

interface ExchangeData {
  rate: number;
  at: number;
}

class Exchange {
  EXCHANGE_RATE_SOURCE =
    "https://api.coinbase.com/v2/exchange-rates?currency=BTC";
  EXCHANGE_RATE_MAX_AGE = 300;
  data?: ExchangeData;

  async getRateUSD(): Promise<number> {
    const EXCHANGE_RATE_MAX_AGE = 300;
    const now = Math.floor(Date.now() / 1000);

    if (!this.data || now - this.data.at > EXCHANGE_RATE_MAX_AGE) {
      const resp = await axios.get<{
        data: { rates: { USD: string } };
      }>(this.EXCHANGE_RATE_SOURCE);

      this.data = {
        rate: 1 / (parseFloat(resp.data.data.rates.USD) * 0.00000001),
        at: now,
      };
    }

    return this.data.rate;
  }
}

export default Exchange;
