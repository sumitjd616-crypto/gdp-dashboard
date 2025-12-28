import numpy as np
from scipy.stats import norm

def black_scholes_gamma(S, K, T, r, sigma):
    """
    Calculate Gamma for an option using Black-Scholes.
    S: Spot price
    K: Strike price
    T: Time to expiration (in years)
    r: Risk-free rate
    sigma: Implied Volatility (decimal)
    """
    if T <= 0 or sigma <= 0:
        return 0.0
    
    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
    gamma = norm.pdf(d1) / (S * sigma * np.sqrt(T))
    return gamma

def calculate_gex(S, K, T, r, sigma, oi, option_type):
    """
    Calculate GEX contribution for a single option.
    Returns GEX in billions (if inputs are standard).
    Actually, let's just return raw Gamma * OI * 100.
    Dealer Gamma is usually Long Calls (positive) and Short Puts (negative) or vice versa depending on perspective.
    Standard assumption: Dealers are Short Calls (Negative Gamma) and Long Puts (Positive Gamma)? 
    NO.
    Standard GEX assumption:
    - Dealers are Long Calls -> Positive Gamma
    - Dealers are Short Puts -> Positive Gamma (Dealers sell puts to customers buying insurance) -> Wait.
    
    Let's stick to the industry standard "SpotGamma" / "Tier1" convention:
    - Calls: Dealers are Short -> Negative Gamma? NO.
    - Market Makers hedge. 
    
    Convention:
    - Customer Buys Call -> Dealer Sells Call -> Dealer is Short Call -> Dealer Longs Stock to hedge.
      As price rises, Dealer needs to buy more (Short Gamma).
      Wait, if Dealer is Short Call, they have Negative Gamma.
      
    - Customer Buys Put -> Dealer Sells Put -> Dealer is Short Put -> Dealer Shorts Stock.
      As price falls, Dealer needs to sell more (Negative Gamma).
      
    Actually, usually it is assumed:
    - Call OI is predominantly Customer Long / Dealer Short (Dealer has Negative Gamma).
    - Put OI is predominantly Customer Long / Dealer Short (Dealer has Positive Gamma? No, Dealer Short Put has Positive Gamma).
    
    Wait. 
    Long Call Gamma = +
    Short Call Gamma = -
    Long Put Gamma = +
    Short Put Gamma = -
    
    If Dealer Sells Call (Short Call), they have Negative Gamma.
    If Dealer Sells Put (Short Put), they have Negative Gamma?
    No. 
    Put Gamma is positive. Shorting it makes it negative.
    
    So if Dealers are net Short options (selling to retail), they are Short Gamma everywhere?
    That implies high volatility everywhere.
    
    The standard "GEX" flip model assumes:
    - Calls contribute POSITIVE Gamma (Dealers are Long Calls? Or maybe the sign convention is reversed).
    
    Let's check the Titan Engine Logic from previous turns.
    `pos = gex > 0`. "POS" regime means smooth, "NEG" means vol.
    Positive Gamma = Mean Reversion (Dealers buy low, sell high).
    Negative Gamma = Acceleration (Dealers sell low, buy high).
    
    If Dealers are Short Calls (Negative Gamma) and Short Puts (Negative Gamma), the market is always unstable? That's not right.
    
    Common assumption:
    - Dealers are LONG Puts (Customer Sells Puts? No, Customers buy Puts).
    - Dealers are SHORT Calls (Customers buy Calls).
    
    Actually, let's look at `titan_engine.ts` logic again or `titan_core.py`.
    It takes `nodes` with `absGamma` and `sign` (implied or calculated?).
    In `titan_core.py`, `gex` is passed as a net number.
    
    I will calculate "Dealer Gamma":
    - Call OI: Assumed Dealer Short -> Negative Gamma?
    - Put OI: Assumed Dealer Short -> Negative Gamma?
    
    Actually, a very common simplified model (SpotGamma style) is:
    - Calls: Dealers are Short (- Gamma)
    - Puts: Dealers are Long (+ Gamma) ... wait, why would dealers be long puts?
      Because funds SELL puts to dealers for yield (Overwriting).
      Or Dealers are Short Puts (Customer buys put) -> Negative Gamma.
      
    Let's use the USER'S logic if possible.
    The user's code `gex > 0` -> Smooth.
    
    Let's assume:
    - Calls adds + Gamma (Assumption: Customers Sell Calls, Dealers Long? Or generic positive contribution).
    - Puts adds - Gamma.
    
    Let's stick to the naive "Call Wall" = Resistance (Positive Gamma) and "Put Wall" = Support (Negative Gamma??).
    Actually, usually Call Wall is Resistance (Dealers Short Calls -> Negative Gamma -> Vol? No).
    
    Let's look at the `generate_nodes` in `streamlit_app.py`:
    `profile == "Call Wall (Resistance)"` -> Adds Gamma.
    
    I will provide raw Gamma for now and let the `TitanEngine` determine the sign.
    `Node` struct has `absGamma`.
    The `gex` total is passed separately.
    
    I will output `Gamma * OI * 100` for each strike.
    Total GEX = Sum(Call Gamma * Call OI) - Sum(Put Gamma * Put OI).
    """
    gamma = black_scholes_gamma(S, K, T, r, sigma)
    # 1 option contract = 100 shares
    return gamma * oi * 100
