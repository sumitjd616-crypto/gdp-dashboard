import websocket
import threading
import json
import time
from config import APIConfig

class TitanStreamer:
    def __init__(self):
        self.latest_price = 0.0
        self.latest_vix = 15.0
        self.connected = False
        self.ws = None
        self.thread = None
        self.lock = threading.Lock()
        
    def start(self):
        if self.thread and self.thread.is_alive():
            return
            
        # Polygon Stocks WebSocket URL
        self.ws_url = "wss://delayed.polygon.io/stocks" # Default to delayed/stocks for stability if key is basic
        # Check key entitlements or try 'socket.polygon.io'
        # Using the standard endpoint
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
        print("WebSocket Opened")
        # Authenticate
        auth_data = {"action": "auth", "params": APIConfig.TOKEN}
        ws.send(json.dumps(auth_data))
        
        # Subscribe to SPY and VIX (Indices cluster usually requires separate sub but lets try T.SPY and A.I:VIX)
        # Polygon Stocks Cluster handles SPY. Indices cluster handles I:VIX.
        # Ideally we need two connections or check if Stocks cluster broadcasts Index aggregates.
        # For simplicity in V4, we focus on SPY trades which proxy SPX moves well intraday.
        subs = {"action": "subscribe", "params": "T.SPY"}
        ws.send(json.dumps(subs))
        self.connected = True

    def on_message(self, ws, message):
        try:
            data = json.loads(message)
            for item in data:
                # T = Trade
                if item.get('ev') == 'T' and item.get('sym') == 'SPY':
                    with self.lock:
                        self.latest_price = item.get('p')
                        
                # A = Aggregate (if we used that)
                elif item.get('ev') == 'A' and item.get('sym') == 'SPY':
                    with self.lock:
                        self.latest_price = item.get('c')
                        
        except Exception as e:
            pass # Silent fail for speed

    def on_error(self, ws, error):
        print(f"WS Error: {error}")
        self.connected = False

    def on_close(self, ws, close_status_code, close_msg):
        print("WS Closed")
        self.connected = False
        
    def get_data(self):
        with self.lock:
            return self.latest_price, self.latest_vix

# Singleton instance holder
_streamer_instance = None

def get_streamer():
    global _streamer_instance
    if _streamer_instance is None:
        _streamer_instance = TitanStreamer()
        _streamer_instance.start()
    return _streamer_instance
