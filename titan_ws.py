import websocket
import threading
import json
import time
from config import APIConfig

class TitanStreamer:
    def __init__(self):
        self.latest_price = 0.0
        self.prev_price = 0.0
        self.latest_vix = 15.0
        self.net_flow = 0 # Net Aggressor Volume (Buys - Sells)
        self.flow_history = [] # For momentum calc
        self.connected = False
        self.ws = None
        self.thread = None
        self.lock = threading.Lock()
        
    def start(self):
        if self.thread and self.thread.is_alive(): return
        self.ws_url = "wss://socket.polygon.io/stocks"
        self.ws = websocket.WebSocketApp(
            self.ws_url,
            on_open=self.on_open,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close
        )
        self.thread = threading.Thread(target=self.ws.run_forever)
        self.thread.daemon = True
        self.thread.start()
        
    def on_open(self, ws):
        print("WebSocket Opened - Stream v5")
        ws.send(json.dumps({"action": "auth", "params": APIConfig.TOKEN}))
        ws.send(json.dumps({"action": "subscribe", "params": "T.SPY"})) # Subscribe to Trades
        self.connected = True

    def on_message(self, ws, message):
        try:
            data = json.loads(message)
            for item in data:
                if item.get('ev') == 'T' and item.get('sym') == 'SPY':
                    p = item.get('p')
                    s = item.get('s', 0) # Size
                    
                    with self.lock:
                        # Aggression Logic (Tick Rule)
                        if self.latest_price > 0:
                            if p > self.latest_price:
                                self.net_flow += s # Buyer Aggressor
                            elif p < self.latest_price:
                                self.net_flow -= s # Seller Aggressor
                                
                        self.prev_price = self.latest_price
                        self.latest_price = p
                        
                        # Decaying Flow (So history doesn't dominate forever)
                        # We decay net_flow by 1% every tick to keep it "fresh"
                        self.net_flow *= 0.99
                        
        except Exception:
            pass

    def on_error(self, ws, error):
        print(f"WS Error: {error}")
        self.connected = False

    def on_close(self, ws, code, msg):
        print("WS Closed")
        self.connected = False
        
    def get_data(self):
        with self.lock:
            return self.latest_price, self.net_flow

_streamer_instance = None
def get_streamer():
    global _streamer_instance
    if _streamer_instance is None:
        _streamer_instance = TitanStreamer()
        _streamer_instance.start()
    return _streamer_instance
