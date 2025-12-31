#!/usr/bin/env python3
"""
TITAN OMEGA - HOLY GRAIL | SPX Dealer Flow Engine
==================================================
✅ LIVE MODE: Real-time during market hours
📚 STUDY MODE: Previous session replay after hours
==================================================
export POLYGON_API_KEY='key' && python titan.py
Dashboard: http://localhost:5000
"""
import asyncio,aiohttp,json,logging,sqlite3,time,os,sys,signal as sg
from dataclasses import dataclass,field
from datetime import datetime,timedelta
from enum import Enum,auto
from typing import Dict,List,Optional,Tuple
from threading import Lock,Thread
from collections import defaultdict
import numpy as np
import websocket
from flask import Flask,render_template_string,jsonify,request
from flask_socketio import SocketIO

# ═══════════════════════════════════════════════════════════════════════════════
# MARKET HOURS CHECKER
# ═══════════════════════════════════════════════════════════════════════════════
class MarketHours:
    """Check if US stock market is open"""
    @staticmethod
    def is_open():
        now = datetime.now()
        # Market hours: Mon-Fri, 9:30 AM - 4:00 PM Eastern
        # Simplified: assume server is in ET or close enough
        weekday = now.weekday()  # 0=Monday, 6=Sunday
        if weekday >= 5:  # Saturday or Sunday
            return False
        hour, minute = now.hour, now.minute
        market_open = (hour == 9 and minute >= 30) or (hour > 9)
        market_close = hour < 16
        return market_open and market_close
    
    @staticmethod
    def get_status():
        if MarketHours.is_open():
            return "🟢 MARKET OPEN", "live"
        now = datetime.now()
        if now.weekday() >= 5:
            return "🔴 WEEKEND - Study Mode", "study"
        hour = now.hour
        if hour < 9 or (hour == 9 and now.minute < 30):
            return "🟡 PRE-MARKET - Study Mode", "study"
        return "🟡 AFTER-HOURS - Study Mode", "study"

MKT = MarketHours()

# ═══════════════════════════════════════════════════════════════════════════════
# CORE CLASSES
# ═══════════════════════════════════════════════════════════════════════════════
class EMA:
    def __init__(s,n=60):s.a=2/(n+1);s.v=s.p=None;s.L=Lock()
    def upd(s,x):
        with s.L:
            if s.v is None:s.v=x
            else:s.p,s.v=s.v,s.a*x+(1-s.a)*s.v
    def roc(s):
        with s.L:return(s.v-s.p)*60 if s.v and s.p else 0
    def val(s):
        with s.L:return s.v or 0

class Shadow:
    A=[(9.5,.70),(10.5,.60),(12,.45),(14,.35),(15.5,.20),(16,.10)]
    def get(s):
        t=datetime.now().hour+datetime.now().minute/60;t=max(9.5,min(16,t))
        for i in range(len(s.A)-1):
            t1,f1=s.A[i];t2,f2=s.A[i+1]
            if t1<=t<=t2:return f1+(t-t1)/(t2-t1)*(f2-f1)
        return .45

class Healer:
    def __init__(s,mn=.03,mx=2,r=2):s.mn,s.mx,s.r=mn,mx,r
    def heal(s,K,iv):
        h=iv.copy();bad=(iv<s.mn)|(iv>s.mx)|np.isnan(iv)
        if not np.any(bad):return h
        idx=np.argsort(K);siv=h[idx]
        for i in np.where(bad[idx])[0]:
            nb=siv[max(0,i-s.r):min(len(siv),i+s.r+1)]
            vld=nb[(nb>=s.mn)&(nb<=s.mx)]
            siv[i]=np.median(vld)if len(vld)else.2
        return siv[np.argsort(idx)]

class Degrader:
    T=[(500,1),(1000,.9),(1500,.8),(2000,.7)]
    def deg(s,c,a):
        if a>2000:return 0,True
        for t,m in s.T:
            if a<=t:return c*m,False
        return c*.7,False

class Cal:
    def __init__(s,p="cal.json"):s.p,s.d,s.L=p,[],Lock()
    def rec(s,dr,sp,gx,cf,rg):
        with s.L:s.d.append({'ts':time.time(),'dt':datetime.now().strftime('%Y-%m-%d'),'dir':dr,'spot':sp,'gex':gx,'conf':cf,'rg':rg,'m5':None});s.d=s.d[-500:]
    def upd(s,sp):
        now=time.time()
        with s.L:
            for p in s.d:
                if now-p['ts']>=300 and p['m5']is None:p['m5']=sp-p['spot']
    def analyze(s):
        with s.L:
            ev=[p for p in s.d if p['m5']is not None]
            if len(ev)<25:return{'st':'NEED_25+','n':len(ev),'sug':[]}
            days=set(p['dt']for p in ev)
            if len(days)<3:return{'st':'NEED_3+DAYS','d':len(days),'n':len(ev),'sug':[]}
            cor=sum(1 for p in ev if(p['dir']=='down'and p['m5']<-3)or(p['dir']=='up'and p['m5']>3)or(p['dir']=='pin'and abs(p['m5'])<3))
            acc=cor/len(ev)*100;sug=[];dn=[p for p in ev if p['dir']=='down']
            if len(dn)>=10:
                er=sum(1 for p in dn if p['m5']>-2)/len(dn)
                if er>.6:sug.append({'t':'REDUCE_SHADOW','c':'HIGH'if er>.75 else'MED','r':f'{er*100:.0f}% early'})
            return{'st':'OK','acc':round(acc,1),'n':len(ev),'d':len(days),'sug':sug}
    def exp(s):
        with s.L:
            try:open(s.p,'w').write(json.dumps({'data':s.d,'analysis':s.analyze()},indent=2))
            except:pass

class Cache:
    def __init__(s,ttl=30):s.ttl,s.c,s.t,s.L=ttl,None,0,Lock()
    def stale(s):return time.time()-s.t>s.ttl
    def get(s):
        with s.L:return s.c
    def set(s,d):
        with s.L:s.c,s.t=d,time.time()

SH,HL,DG,CL,CC=Shadow(),Healer(),Degrader(),Cal(),Cache()

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIG & DATA
# ═══════════════════════════════════════════════════════════════════════════════
@dataclass
class Cfg:
    @property
    def KEY(s):return os.environ.get('POLYGON_API_KEY','')
    R:float=.053;GF:float=-1.5e8;GS:float=1.2e8;GX:float=-3e8;IT:float=.001
    PS:int=1000;PM:int=5;DB:str="titan.db";H:str="0.0.0.0";P:int=5000;FB:float=5970

class Rg(Enum):
    N=auto();FL=auto();WF=auto();CH=auto();SQ=auto();PN=auto();SF=auto()

class Q(Enum):
    G=auto();P=auto();B=auto()

@dataclass
class Chn:
    ts:int;K:np.ndarray;T:np.ndarray;iv:np.ndarray;oi:np.ndarray;vo:np.ndarray;ca:np.ndarray;hl:int=0
    @property
    def age(s):return int(time.time()*1000)-s.ts
    @property
    def n(s):return len(s.K)
    @property
    def aiv(s):return float(np.nanmean(s.iv))if s.n else 0

@dataclass
class Sig:
    rg:Rg;cf:float;rw:float;pl:str;co:str;gex:float;vex:float;cex:float;dlt:float
    sp:float;iv:float;ir:float;gr:float;sr:float;q:Q;nu:int;nf:int;nh:int;ag:int;sh:float;cn:int;dg:bool
    ts:datetime=field(default_factory=datetime.now)

# ═══════════════════════════════════════════════════════════════════════════════
# STATE
# ═══════════════════════════════════════════════════════════════════════════════
class St:
    def __init__(s):
        s.L=Lock();s.sp=0.0;s.st=0;s.ch=None;s.sg=None;s.r=.053
        s.ge,s.se,s.ie=EMA(),EMA(),EMA();s.al=[]
    def ssp(s,p,t=None):
        with s.L:s.sp,s.st=p,t or int(time.time()*1000);s.se.upd(p)
    def sch(s,c):
        with s.L:s.ch=c;s.ie.upd(c.aiv)
    def ssg(s,g):
        with s.L:s.sg=g
        if g.q==Q.G:s.ge.upd(g.gex)
    def aal(s,a):
        with s.L:s.al.append(a);s.al=s.al[-50:]
    def sn(s):
        with s.L:return{'sp':s.sp,'st':s.st,'ch':s.ch,'r':s.r,'gr':s.ge.roc(),'sr':s.se.roc(),'ir':s.ie.roc(),'iv':s.ie.val(),'al':s.al[-10:]}
    def sy(s):
        with s.L:
            if not s.ch:return False,999999
            return abs(s.st-s.ch.ts)<=500,abs(s.st-s.ch.ts)

S=St()

# ═══════════════════════════════════════════════════════════════════════════════
# FEED
# ═══════════════════════════════════════════════════════════════════════════════
class Fd:
    def __init__(s,cfg):s.cfg,s.ws,s.run,s.ses=cfg,None,False,None
    
    async def fetch(s,sym="SPX"):
        k=s.cfg.KEY
        if not k:return None
        if not CC.stale():
            c=CC.get()
            if c:return s._parse(c)
        try:
            if not s.ses:s.ses=aiohttp.ClientSession()
            td,wk=datetime.now().strftime('%Y-%m-%d'),(datetime.now()+timedelta(days=7)).strftime('%Y-%m-%d')
            res,nxt=[],None
            for _ in range(s.cfg.PM):
                if nxt:
                    async with s.ses.get(f"{nxt}&apiKey={k}")as r:
                        if r.status!=200:break
                        d=await r.json()
                else:
                    async with s.ses.get(f"https://api.polygon.io/v3/snapshot/options/{sym}",params={'apiKey':k,'limit':s.cfg.PS,'expiration_date.gte':td,'expiration_date.lte':wk})as r:
                        if r.status!=200:break
                        d=await r.json()
                rs=d.get('results',[])
                if not rs:break
                res.extend(rs);nxt=d.get('next_url')
                if not nxt:break
                await asyncio.sleep(.02)
            if not res:return None
            CC.set(res);logging.info(f"📊{len(res)}")
            return s._parse(res)
        except Exception as e:logging.error(f"F:{e}");return None
    
    def _parse(s,res):
        n=len(res);K,T,iv,oi,vo,ca=np.zeros(n),np.zeros(n),np.zeros(n),np.zeros(n),np.zeros(n),np.zeros(n,dtype=bool)
        for i,o in enumerate(res):
            d,dy,g=o.get('details',{}),o.get('day',{}),o.get('greeks',{})
            K[i]=d.get('strike_price',0);ca[i]=d.get('contract_type','').lower()=='call'
            exp=d.get('expiration_date','')
            if exp:
                try:T[i]=datetime.strptime(exp,'%Y-%m-%d').timestamp()
                except:pass
            iv[i]=g.get('implied_volatility',.2);oi[i]=dy.get('open_interest',0);vo[i]=dy.get('volume',0)
        bd=int(np.sum((iv<.03)|(iv>2)));iv=HL.heal(K,iv)
        return Chn(int(time.time()*1000),K,T,iv,oi,vo,ca,bd)
    
    def _msg(s,ws,m):
        try:
            for e in json.loads(m):
                if e.get('ev')in('V','A','AM')and'SPX'in e.get('sym','').upper():
                    v=e.get('val')or e.get('c',0)
                    if v>0:S.ssp(v,e.get('t')or e.get('e'))
        except:pass
    
    def _open(s,ws):
        logging.info("✅WS");k=s.cfg.KEY
        if k:ws.send(json.dumps({"action":"auth","params":k}));ws.send(json.dumps({"action":"subscribe","params":"V.I:SPX,A.I:SPX"}))
    
    def _close(s,ws,*a):
        if s.run:time.sleep(5);s._conn()
    
    def _conn(s):
        if not s.cfg.KEY:return
        s.ws=websocket.WebSocketApp("wss://socket.polygon.io/indices",on_open=s._open,on_message=s._msg,on_close=s._close)
        s.ws.run_forever()
    
    def start(s):s.run=True;Thread(target=s._conn,daemon=True).start()
    def stop(s):s.run=False;s.ws and s.ws.close()

# ═══════════════════════════════════════════════════════════════════════════════
# GREEKS
# ═══════════════════════════════════════════════════════════════════════════════
class Gk:
    def __init__(s,cfg):s.cfg=cfg
    @staticmethod
    def nc(x):
        try:
            from scipy.special import erf
            return .5*(1+erf(x/np.sqrt(2)))
        except ImportError:
            t = 1.0 / (1.0 + 0.2316419 * np.abs(x))
            d = 0.3989422804014327 * np.exp(-x * x / 2)
            p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
            return np.where(x > 0, 1 - p, p)
    @staticmethod
    def np(x):return np.exp(-.5*x**2)/np.sqrt(2*np.pi)
    
    def filt(s,c,S):
        ok=(np.abs(c.K-S)/S<=.10)&((c.oi>0)|(c.vo>0))&(c.K>0);nf=np.sum(~ok)
        return Chn(c.ts,c.K[ok],c.T[ok],c.iv[ok],c.oi[ok],c.vo[ok],c.ca[ok],c.hl),nf
    
    def comp(s,S,c,r,sh):
        if c.n==0:return 0,0,0,0,{},Q.B
        K,iv,oi,vo,ca=c.K,c.iv,c.oi,c.vo,c.ca
        T=np.maximum((c.T-time.time())/(365.25*24*3600),1e-6);sqT=np.sqrt(T);sg=np.maximum(iv*sqT,1e-10)
        d1=(np.log(S/K)+(r+.5*iv**2)*T)/sg;d2=d1-sg;pdf,cdf=s.np(d1),s.nc(d1)
        gam,van,chm=pdf/(S*sg),(pdf*d2)/iv,(pdf*((2*r*T)-(d2*sg))/(2*np.maximum(T,1e-10)*sg))/365
        dlt=np.where(ca,cdf,cdf-1);sgn=np.where(ca,1.,-1.);soi=oi+vo*sh
        gex,vex,cex,net=sgn*gam*soi*100*S**2*.01,sgn*van*soi*100*S*.01,sgn*chm*soi*100*S,dlt*soi*100
        bk={f"{k:.0f}":{'g':float(np.nansum(gex[K==k]))/1e6}for k in np.unique(K)}
        return np.nansum(gex),np.nansum(vex),np.nansum(cex),np.nansum(net),bk,Q.G if c.n>=100 else Q.P

# ═══════════════════════════════════════════════════════════════════════════════
# DETECTOR
# ═══════════════════════════════════════════════════════════════════════════════
class Dt:
    def __init__(s,cfg):s.cfg=cfg
    
    def det(s,gex,vex,cex,dlt,sp,iv,ir,gr,sr,q,ag,nu,nf,nh,sh,cn):
        _,fsf=DG.deg(100,ag)
        if q==Q.B or fsf:
            return Sig(Rg.SF,0,0,f"⚠️SAFE\n{'Stale>2s'if fsf else'Bad'}\nAge:{ag}ms","#374151",gex,vex,cex,dlt,sp,iv,ir,gr,sr,q,nu,nf,nh,ag,sh,cn,fsf)
        rg,rw,pl,co=Rg.N,0,"NEUTRAL","#020617"
        ivu,fl,ac=ir>s.cfg.IT,sr<-.5,gr<-1e7
        
        if gex<s.cfg.GX and vex>0 and fl and ac and ivu:
            rg,rw=Rg.WF,min(95,72+abs(gex/s.cfg.GX)*10)
            pl=f"🌊WATERFALL\nGEX:${gex/1e6:.1f}M VEX:${vex/1e6:.1f}M\nIV:{iv*100:.1f}%⬆️\n\nFADE RIP|Stop:7|Tgt:15-20";co="#7f1d1d"
        elif gex<s.cfg.GF and vex>0:
            rg,rw=Rg.FL,min(85,55+abs(gex/s.cfg.GF)*20)
            pl=f"⚠️FLUSH\nGEX:${gex/1e6:.1f}M VEX:${vex/1e6:.1f}M\n{'🔴CASCADE!'if ivu else'Wait IV↑'}";co="#450a0a"
        elif gex>s.cfg.GS and cex>0:
            rg,rw=Rg.CH,min(80,50+gex/s.cfg.GS*20)
            pl=f"📈CHARM\nGEX:+${gex/1e6:.1f}M CEX:+${cex/1e6:.1f}M\n\nBUY DIP|Tgt:10-15";co="#064e3b"
        elif gex<0 and dlt>0 and sr>.3:
            rg,rw=Rg.SQ,min(75,45+abs(dlt/1e8)*15)
            pl=f"🚀SQUEEZE\nGEX:${gex/1e6:.1f}M Δ:+${dlt/1e6:.1f}M";co="#0d9488"
        else:
            pn=round(sp/5)*5;ds=abs(sp-pn)
            if ds<2 and abs(gex)>5e7:
                rg,rw=Rg.PN,min(70,55+(2-ds)*10)
                pl=f"📌PIN@{pn}|Dist:{ds:.1f}";co="#1e40af"
        
        fn,_=DG.deg(rw,ag);dg=fn<rw
        if dg and rg!=Rg.N:pl+=f"\n⚠️{rw:.0f}→{fn:.0f}%"
        return Sig(rg,fn,rw,pl,co,gex,vex,cex,dlt,sp,iv,ir,gr,sr,q,nu,nf,nh,ag,sh,cn,dg)

# ═══════════════════════════════════════════════════════════════════════════════
# DATABASE WITH HISTORY
# ═══════════════════════════════════════════════════════════════════════════════
class DB:
    def __init__(s,p):
        s.p=p
        with sqlite3.connect(p)as c:
            # Main signals table with full data
            c.execute("""CREATE TABLE IF NOT EXISTS signals(
                id INTEGER PRIMARY KEY,
                ts TEXT,
                date TEXT,
                time TEXT,
                rg TEXT,
                cf REAL,
                gex REAL,
                vex REAL,
                cex REAL,
                sp REAL,
                iv REAL,
                pl TEXT,
                ag INT
            )""")
            # Alerts table
            c.execute("""CREATE TABLE IF NOT EXISTS alerts(
                id INTEGER PRIMARY KEY,
                ts TEXT,
                date TEXT,
                time TEXT,
                tp TEXT,
                sp REAL,
                cf REAL,
                gex REAL,
                pl TEXT
            )""")
            # Session summary
            c.execute("""CREATE TABLE IF NOT EXISTS sessions(
                id INTEGER PRIMARY KEY,
                date TEXT UNIQUE,
                open_sp REAL,
                close_sp REAL,
                high_sp REAL,
                low_sp REAL,
                total_signals INT,
                dominant_regime TEXT,
                summary TEXT
            )""")
    
    def save_signal(s,g):
        try:
            now = datetime.now()
            with sqlite3.connect(s.p)as c:
                c.execute("""INSERT INTO signals(ts,date,time,rg,cf,gex,vex,cex,sp,iv,pl,ag)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (now.isoformat(), now.strftime('%Y-%m-%d'), now.strftime('%H:%M:%S'),
                     g.rg.name, g.cf, g.gex, g.vex, g.cex, g.sp, g.iv, g.pl, g.ag))
        except:pass
    
    def save_alert(s,rg,sp,cf,gex,pl):
        try:
            now = datetime.now()
            with sqlite3.connect(s.p)as c:
                c.execute("""INSERT INTO alerts(ts,date,time,tp,sp,cf,gex,pl)
                    VALUES(?,?,?,?,?,?,?,?)""",
                    (now.isoformat(), now.strftime('%Y-%m-%d'), now.strftime('%H:%M:%S'),
                     rg, sp, cf, gex, pl))
        except:pass
    
    def get_recent_alerts(s,n=10):
        try:
            with sqlite3.connect(s.p)as c:
                return [{'ts':r[0],'date':r[1],'time':r[2],'tp':r[3],'sp':r[4],'cf':r[5],'gex':r[6],'pl':r[7]} 
                    for r in c.execute(f"SELECT ts,date,time,tp,sp,cf,gex,pl FROM alerts ORDER BY ts DESC LIMIT {n}")]
        except:return[]
    
    def get_session_signals(s, date=None):
        """Get all signals for a specific date (defaults to last trading day)"""
        try:
            with sqlite3.connect(s.p)as c:
                if date:
                    query = "SELECT * FROM signals WHERE date=? ORDER BY ts"
                    rows = c.execute(query, (date,)).fetchall()
                else:
                    # Get the most recent date with signals
                    date_row = c.execute("SELECT DISTINCT date FROM signals ORDER BY date DESC LIMIT 1").fetchone()
                    if not date_row:
                        return [], None
                    date = date_row[0]
                    rows = c.execute("SELECT * FROM signals WHERE date=? ORDER BY ts", (date,)).fetchall()
                
                signals = []
                for r in rows:
                    signals.append({
                        'id': r[0], 'ts': r[1], 'date': r[2], 'time': r[3],
                        'rg': r[4], 'cf': r[5], 'gex': r[6], 'vex': r[7],
                        'cex': r[8], 'sp': r[9], 'iv': r[10], 'pl': r[11], 'ag': r[12]
                    })
                return signals, date
        except Exception as e:
            logging.error(f"DB error: {e}")
            return [], None
    
    def get_session_summary(s, date=None):
        """Get summary stats for a session"""
        signals, actual_date = s.get_session_signals(date)
        if not signals:
            return None
        
        spots = [sig['sp'] for sig in signals]
        regimes = [sig['rg'] for sig in signals if sig['rg'] not in ('N', 'SF')]
        
        # Count regime occurrences
        regime_counts = {}
        for rg in regimes:
            regime_counts[rg] = regime_counts.get(rg, 0) + 1
        
        dominant = max(regime_counts.items(), key=lambda x: x[1])[0] if regime_counts else 'N'
        
        # Key signals (high confidence, non-neutral)
        key_signals = [sig for sig in signals if sig['cf'] >= 60 and sig['rg'] not in ('N', 'SF')]
        
        return {
            'date': actual_date,
            'total_signals': len(signals),
            'open_sp': spots[0] if spots else 0,
            'close_sp': spots[-1] if spots else 0,
            'high_sp': max(spots) if spots else 0,
            'low_sp': min(spots) if spots else 0,
            'range': max(spots) - min(spots) if spots else 0,
            'dominant_regime': dominant,
            'regime_counts': regime_counts,
            'key_signals': key_signals[-20:],  # Last 20 key signals
            'all_signals': signals
        }
    
    def get_available_dates(s):
        """Get list of dates with data"""
        try:
            with sqlite3.connect(s.p)as c:
                rows = c.execute("SELECT DISTINCT date FROM signals ORDER BY date DESC LIMIT 30").fetchall()
                return [r[0] for r in rows]
        except:
            return []

# ═══════════════════════════════════════════════════════════════════════════════
# ENGINE
# ═══════════════════════════════════════════════════════════════════════════════
class Eng:
    def __init__(s,cfg=None):
        s.cfg=cfg or Cfg();s.gk=Gk(s.cfg);s.dt=Dt(s.cfg);s.db=DB(s.cfg.DB);s.fd=Fd(s.cfg);s.run=False
        logging.basicConfig(level=logging.INFO,format='%(asctime)s|%(message)s',datefmt='%H:%M:%S')
    
    def _demo(s,S):
        b=round(S/5)*5;ar=np.arange(b-50,b+55,5);n=len(ar)
        K=np.concatenate([ar,ar]);ca=np.concatenate([np.ones(n,dtype=bool),np.zeros(n,dtype=bool)])
        T=np.full(len(K),datetime.now().replace(hour=16).timestamp())
        m=(S-K)/S;iv=np.clip(.15*(1+np.abs(m)*1.5),.05,.8)
        oi=5000*np.exp(-12*m**2)*np.where(ca,1,1.3)
        return Chn(int(time.time()*1000),K,T,iv,oi,oi*.3,ca,0)
    
    async def _chn(s):
        while s.run:
            try:
                c=await s.fd.fetch()
                if c and c.n:S.sch(c)
            except:pass
            await asyncio.sleep(5)
    
    async def _cal(s):
        while s.run:
            sn=S.sn()
            if sn['sp']>0:CL.upd(sn['sp'])
            await asyncio.sleep(60)
    
    async def _main(s,sio):
        while s.run:
            try:
                # Check market status
                mkt_status, mkt_mode = MKT.get_status()
                
                sn=S.sn();sp=sn['sp']or s.cfg.FB
                if sn['sp']<=0:S.ssp(sp)
                ch=sn['ch']or s._demo(sp)
                if not sn['ch']:S.sch(ch)
                _,ag=S.sy();sh=SH.get()
                ft,nf=s.gk.filt(ch,sp)
                gex,vex,cex,dlt,bk,q=s.gk.comp(sp,ft,sn['r'],sh)
                sg=s.dt.det(gex,vex,cex,dlt,sp,sn['iv'],sn['ir'],sn['gr'],sn['sr'],q,ag,ft.n,nf,ch.hl,sh,ch.n)
                S.ssg(sg)
                
                # Save to database
                if sg.rg not in(Rg.N,Rg.SF)and sg.cf>50:
                    dr='down'if sg.rg in(Rg.WF,Rg.FL)else'up'if sg.rg in(Rg.CH,Rg.SQ)else'pin'
                    CL.rec(dr,sp,gex,sg.cf,sg.rg.name)
                    s.db.save_signal(sg)
                    s.db.save_alert(sg.rg.name, sp, sg.cf, gex, sg.pl)
                
                # Get historical data for study mode
                hist_summary = None
                if mkt_mode == 'study':
                    hist_summary = s.db.get_session_summary()
                
                ca=CL.analyze()
                
                # Emit update
                emit_data = {
                    'r':sg.rg.name,'c':round(sg.cf,1),'p':sg.pl,'co':sg.co,
                    'gex':round(gex/1e6,2),'vex':round(vex/1e6,2),'cex':round(cex/1e6,2),
                    'sp':round(sp,2),'iv':round(sn['iv']*100,2),'ir':round(sn['ir']*100,4),
                    'ts':datetime.now().strftime('%H:%M:%S'),'q':q.name,'nu':ft.n,
                    'nh':ch.hl,'ag':ag,'sh':round(sh,3),'cn':ch.n,'dg':sg.dg,
                    'cs':ca.get('st',''),'ca':ca.get('acc',0),'csig':ca.get('n',0),
                    'sug':ca.get('sug',[]),'bk':bk,'al':s.db.get_recent_alerts(5),
                    'mkt_status': mkt_status, 'mkt_mode': mkt_mode,
                    'hist': hist_summary
                }
                sio.emit('u', emit_data)
                
                if sg.rg!=Rg.N:logging.info(f"🎯{sg.rg.name}|{sg.cf:.0f}%|Ag:{ag}")
            except Exception as e:logging.error(f"E:{e}")
            await asyncio.sleep(1)
    
    def start(s,sio):
        s.run=True;s.fd.start()
        def run_chn():
            lp=asyncio.new_event_loop();asyncio.set_event_loop(lp)
            lp.run_until_complete(s._chn())
        def run_cal():
            lp=asyncio.new_event_loop();asyncio.set_event_loop(lp)
            lp.run_until_complete(s._cal())
        def run_main():
            lp=asyncio.new_event_loop();asyncio.set_event_loop(lp)
            lp.run_until_complete(s._main(sio))
        Thread(target=run_chn,daemon=True).start()
        Thread(target=run_cal,daemon=True).start()
        Thread(target=run_main,daemon=True).start()
        logging.info("🚀TITAN OMEGA")
    
    def stop(s):s.run=False;s.fd.stop();CL.exp()

# ═══════════════════════════════════════════════════════════════════════════════
# DASHBOARD WITH STUDY MODE
# ═══════════════════════════════════════════════════════════════════════════════
HTML="""<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TITAN OMEGA</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.6.1/socket.io.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
:root{--b:#09090b;--c:#18181b;--d:#27272a;--t:#fafafa;--m:#71717a;--g:#22c55e;--r:#ef4444;--l:#3b82f6;--y:#eab308;--o:#f97316}
*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:var(--b);color:var(--t);min-height:100vh}
.D{display:grid;grid-template-columns:1fr 300px;min-height:100vh}
.M{padding:8px;display:flex;flex-direction:column;gap:6px}
.H{display:flex;justify-content:space-between;align-items:center;padding-bottom:5px;border-bottom:1px solid var(--d)}
.L{display:flex;align-items:center;gap:5px}
.I{width:24px;height:24px;background:linear-gradient(135deg,var(--l),#8b5cf6);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}
.L h1{font-size:12px}.L span{font-size:7px;color:var(--m)}
.S{display:flex;align-items:center;gap:3px;font-size:7px}
.O{width:5px;height:5px;border-radius:50%;background:var(--g);animation:p 2s infinite}
.O.w{background:var(--y)}.O.x{background:var(--r)}@keyframes p{0%,100%{opacity:1}50%{opacity:.5}}
.MKT{font-size:8px;padding:2px 6px;border-radius:3px;margin-left:5px}
.MKT.live{background:#166534;color:#86efac}
.MKT.study{background:#854d0e;color:#fef08a}
.G{display:grid;grid-template-columns:repeat(6,1fr);gap:4px}
.B{background:var(--c);border-radius:4px;padding:5px}
.BL{font-size:6px;color:var(--m);text-transform:uppercase;margin-bottom:1px}
.BV{font-size:11px;font-weight:700;font-family:monospace}.BV.p{color:var(--g)}.BV.n{color:var(--r)}
.BS{font-size:6px;color:var(--m)}
.C{background:var(--c);border-radius:4px;padding:6px;flex:1}
.CH{display:flex;justify-content:space-between;margin-bottom:4px;font-size:8px}
.HM{background:var(--c);border-radius:4px;padding:5px;max-height:120px;overflow-y:auto}
.HR{display:flex;align-items:center;padding:1px 0;border-bottom:1px solid var(--d)}
.HK{width:35px;font-family:monospace;font-size:7px}
.HB{flex:1;height:8px;border-radius:2px;overflow:hidden}
.HF{height:100%}.HF.p{background:var(--g)}.HF.n{background:var(--r)}
.HV{width:35px;text-align:right;font-family:monospace;font-size:6px}
.SD{background:var(--c);border-left:1px solid var(--d);padding:8px;display:flex;flex-direction:column;gap:5px;transition:background .5s;overflow-y:auto}
.SD.FL{background:linear-gradient(180deg,#450a0a 0%,var(--c) 25%)}
.SD.WF{background:linear-gradient(180deg,#7f1d1d 0%,var(--c) 25%)}
.SD.CH{background:linear-gradient(180deg,#064e3b 0%,var(--c) 25%)}
.SD.SQ{background:linear-gradient(180deg,#134e4a 0%,var(--c) 25%)}
.SD.PN{background:linear-gradient(180deg,#1e3a8a 0%,var(--c) 25%)}
.SD.SF{background:linear-gradient(180deg,#374151 0%,var(--c) 25%)}
.RG{background:#27272a;border-radius:4px;padding:6px}
.RH{display:flex;justify-content:space-between;margin-bottom:4px}
.RN{font-size:10px;font-weight:700;text-transform:uppercase}
.RC{font-family:monospace;font-size:8px;padding:1px 3px;background:rgba(255,255,255,.1);border-radius:2px}
.RC.dg{color:var(--o)}
.PL{background:var(--b);border-radius:3px;padding:5px;font-family:monospace;font-size:8px;line-height:1.2;white-space:pre-wrap;max-height:90px;overflow-y:auto}
.DQ{background:#27272a;border-radius:3px;padding:5px;font-size:7px}
.DT{font-weight:600;margin-bottom:2px}
.DR{display:flex;justify-content:space-between;padding:1px 0}
.DL{color:var(--m)}.DV{font-family:monospace}
.DV.g{color:var(--g)}.DV.w{color:var(--y)}.DV.x{color:var(--r)}.DV.o{color:var(--o)}
.CL{background:#27272a;border-radius:3px;padding:5px;font-size:7px}
.CT{font-weight:600;margin-bottom:2px;color:var(--y)}
.SG{background:var(--b);border-radius:2px;padding:2px;margin-top:2px;font-size:6px;color:var(--y)}
.AL{margin-top:5px}.AT{font-size:7px;color:var(--m);margin-bottom:2px;display:flex;justify-content:space-between}
.A{background:var(--b);border-radius:2px;padding:3px;margin-bottom:2px;border-left:2px solid var(--l);font-size:6px}
.A.FL{border-color:var(--r)}.A.WF{border-color:#dc2626}.A.CH{border-color:var(--g)}.A.SQ{border-color:#14b8a6}.A.PN{border-color:var(--l)}
.AX{color:var(--m);font-family:monospace}.AN{font-weight:600}
.AP{font-size:5px;color:var(--m);margin-top:1px}
.STUDY{background:linear-gradient(135deg,#422006,#1c1917);border:1px solid #854d0e;border-radius:4px;padding:6px;margin-bottom:5px}
.STUDY-H{font-size:9px;font-weight:700;color:#fef08a;margin-bottom:4px;display:flex;align-items:center;gap:4px}
.STUDY-S{display:grid;grid-template-columns:repeat(2,1fr);gap:4px;font-size:7px}
.STUDY-I{background:rgba(0,0,0,.3);padding:3px;border-radius:2px}
.STUDY-L{color:#a3a3a3}.STUDY-V{font-weight:600;color:#fef08a}
.SIG-LIST{max-height:200px;overflow-y:auto;margin-top:5px}
.SIG{background:var(--b);border-radius:2px;padding:3px;margin-bottom:2px;font-size:6px;border-left:2px solid var(--d)}
.SIG.FL{border-color:var(--r)}.SIG.WF{border-color:#dc2626}.SIG.CH{border-color:var(--g)}.SIG.SQ{border-color:#14b8a6}.SIG.PN{border-color:var(--l)}
.SIG-T{color:var(--m);font-family:monospace}.SIG-R{font-weight:600}.SIG-D{color:var(--m);margin-top:1px}
</style></head><body>
<div class="D">
<div class="M">
<div class="H">
<div class="L"><div class="I">Ω</div><div><h1>TITAN OMEGA</h1><span>Holy Grail|SPX Flow</span></div></div>
<div class="S">
<div class="O" id="o"></div><span id="s">...</span>
<span class="MKT" id="mkt">--</span>
</div>
</div>
<div class="G">
<div class="B"><div class="BL">SPX</div><div class="BV" id="sp">--</div></div>
<div class="B"><div class="BL">GEX</div><div class="BV" id="gx">--</div></div>
<div class="B"><div class="BL">VEX</div><div class="BV" id="vx">--</div></div>
<div class="B"><div class="BL">IV</div><div class="BV" id="iv">--</div><div class="BS" id="ir">--</div></div>
<div class="B"><div class="BL">Chain</div><div class="BV" id="cn">--</div><div class="BS">H:<span id="nh">0</span></div></div>
<div class="B"><div class="BL">Age</div><div class="BV" id="ag">--</div></div>
</div>
<div class="C"><div class="CH"><span>GEX Timeline</span><span id="ts">--</span></div><canvas id="cv" height="100"></canvas></div>
<div class="HM"><div class="CH"><span>Strike GEX</span></div><div id="hm"></div></div>
</div>
<div class="SD" id="sd">
<div class="RG"><div class="RH"><span class="RN" id="rg">INIT</span><span class="RC" id="cf">--</span></div><div class="PL" id="pl">Loading...</div></div>

<!-- STUDY MODE PANEL -->
<div class="STUDY" id="study" style="display:none">
<div class="STUDY-H">📚 STUDY MODE - Previous Session</div>
<div class="STUDY-S">
<div class="STUDY-I"><div class="STUDY-L">Date</div><div class="STUDY-V" id="st-date">--</div></div>
<div class="STUDY-I"><div class="STUDY-L">Signals</div><div class="STUDY-V" id="st-cnt">--</div></div>
<div class="STUDY-I"><div class="STUDY-L">Open</div><div class="STUDY-V" id="st-open">--</div></div>
<div class="STUDY-I"><div class="STUDY-L">Close</div><div class="STUDY-V" id="st-close">--</div></div>
<div class="STUDY-I"><div class="STUDY-L">High</div><div class="STUDY-V" id="st-high">--</div></div>
<div class="STUDY-I"><div class="STUDY-L">Low</div><div class="STUDY-V" id="st-low">--</div></div>
<div class="STUDY-I"><div class="STUDY-L">Range</div><div class="STUDY-V" id="st-range">--</div></div>
<div class="STUDY-I"><div class="STUDY-L">Dominant</div><div class="STUDY-V" id="st-dom">--</div></div>
</div>
<div class="AT" style="margin-top:5px"><span>Key Signals</span></div>
<div class="SIG-LIST" id="st-sigs"></div>
</div>

<div class="DQ">
<div class="DT">📡 Data Quality</div>
<div class="DR"><span class="DL">Quality</span><span class="DV" id="ql">--</span></div>
<div class="DR"><span class="DL">Age</span><span class="DV" id="a2">--</span></div>
<div class="DR"><span class="DL">Degraded</span><span class="DV" id="dg">--</span></div>
</div>
<div class="CL">
<div class="CT">📊 Calibration</div>
<div class="DR"><span class="DL">Status</span><span class="DV" id="cs">--</span></div>
<div class="DR"><span class="DL">Accuracy</span><span class="DV g" id="ca">--</span></div>
<div id="sg"></div>
</div>
<div class="AL"><div class="AT"><span>📋 Recent Alerts</span></div><div id="al"></div></div>
</div>
</div>
<script>
const io=window.io(),gD=[],gL=[];
const cx=document.getElementById('cv').getContext('2d');
const ct=new Chart(cx,{type:'line',data:{labels:gL,datasets:[{data:gD,borderColor:'#3b82f6',backgroundColor:'rgba(59,130,246,.1)',fill:true,tension:.4,pointRadius:0,borderWidth:1.5}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{display:true,grid:{color:'#27272a'},ticks:{color:'#71717a',maxTicksLimit:6,font:{size:7}}},y:{display:true,grid:{color:'#27272a'},ticks:{color:'#71717a',callback:v=>v+'M',font:{size:7}}}},animation:{duration:0}}});

io.on('connect',()=>{document.getElementById('s').textContent='Live';document.getElementById('o').className='O'});
io.on('disconnect',()=>{document.getElementById('s').textContent='Off';document.getElementById('o').className='O x'});

io.on('u',d=>{
// Market status
const mkt=document.getElementById('mkt');
mkt.textContent=d.mkt_status||'--';
mkt.className='MKT '+(d.mkt_mode||'study');

// Show/hide study panel
const studyPanel=document.getElementById('study');
if(d.mkt_mode==='study' && d.hist){
    studyPanel.style.display='block';
    const h=d.hist;
    document.getElementById('st-date').textContent=h.date||'--';
    document.getElementById('st-cnt').textContent=h.total_signals||0;
    document.getElementById('st-open').textContent=h.open_sp?.toFixed(2)||'--';
    document.getElementById('st-close').textContent=h.close_sp?.toFixed(2)||'--';
    document.getElementById('st-high').textContent=h.high_sp?.toFixed(2)||'--';
    document.getElementById('st-low').textContent=h.low_sp?.toFixed(2)||'--';
    document.getElementById('st-range').textContent=h.range?.toFixed(2)||'--';
    document.getElementById('st-dom').textContent=h.dominant_regime||'--';
    
    // Key signals list
    const sigList=document.getElementById('st-sigs');
    sigList.innerHTML='';
    if(h.key_signals){
        h.key_signals.slice().reverse().forEach(sig=>{
            const el=document.createElement('div');
            el.className='SIG '+sig.rg;
            el.innerHTML=`<div><span class="SIG-T">${sig.time}</span> <span class="SIG-R">${sig.rg}</span> ${sig.cf?.toFixed(0)}%</div><div class="SIG-D">SPX:${sig.sp?.toFixed(2)} GEX:${(sig.gex/1e6)?.toFixed(1)}M</div>`;
            sigList.appendChild(el);
        });
    }
}else{
    studyPanel.style.display='none';
}

document.getElementById('sp').textContent=d.sp.toFixed(2);
const sv=(i,v)=>{const e=document.getElementById(i);e.textContent=v.toFixed(1);e.className='BV '+(v>=0?'p':'n')};
sv('gx',d.gex);sv('vx',d.vex);
document.getElementById('iv').textContent=d.iv.toFixed(1)+'%';
document.getElementById('ir').textContent=(d.ir>0?'+':'')+d.ir+'%/s';
document.getElementById('cn').textContent=d.cn;document.getElementById('nh').textContent=d.nh;
const ae=document.getElementById('ag');ae.textContent=d.ag+'ms';ae.className='BV '+(d.ag<500?'p':d.ag<1500?'':'n');
document.getElementById('ts').textContent=d.ts;
document.getElementById('rg').textContent=d.r;
const ce=document.getElementById('cf');ce.textContent=d.c+'%'+(d.dg?' ↓':'');ce.className='RC'+(d.dg?' dg':'');
document.getElementById('pl').textContent=d.p;
const s=document.getElementById('sd');s.className='SD';s.classList.add(d.r);
const qe=document.getElementById('ql');qe.textContent=d.q;qe.className='DV '+(d.q==='G'?'g':d.q==='P'?'w':'x');
const a2=document.getElementById('a2');a2.textContent=d.ag+'ms';a2.className='DV '+(d.ag<500?'g':d.ag<1500?'w':'x');
const de=document.getElementById('dg');de.textContent=d.dg?'YES':'NO';de.className='DV '+(d.dg?'o':'g');
document.getElementById('cs').textContent=d.cs;
document.getElementById('ca').textContent=(d.ca||0).toFixed(1)+'%';
const sg=document.getElementById('sg');sg.innerHTML='';
if(d.sug&&d.sug.length)d.sug.forEach(x=>{const v=document.createElement('div');v.className='SG';v.textContent='⚠️'+x.t+':'+x.r;sg.appendChild(v)});
document.getElementById('o').className='O'+(d.q!=='G'||d.dg?' w':'');
gD.push(d.gex);gL.push(d.ts);if(gD.length>60){gD.shift();gL.shift()}ct.update();
const hm=document.getElementById('hm');hm.innerHTML='';
const bk=Object.entries(d.bk).sort((a,b)=>+b[0]-+a[0]).slice(0,8);
const mx=Math.max(...bk.map(x=>Math.abs(x[1].g)),1);
bk.forEach(([k,v])=>{const r=document.createElement('div');r.className='HR';const p=v.g>=0;
r.innerHTML='<div class="HK">'+k+'</div><div class="HB"><div class="HF '+(p?'p':'n')+'" style="width:'+Math.abs(v.g)/mx*100+'%"></div></div><div class="HV" style="color:'+(p?'#22c55e':'#ef4444')+'">'+(v.g>0?'+':'')+v.g.toFixed(1)+'M</div>';hm.appendChild(r)});
const al=document.getElementById('al');al.innerHTML='';
if(d.al)d.al.forEach(a=>{const e=document.createElement('div');e.className='A '+(a.tp||'');
e.innerHTML='<div class="AX">'+(a.time||a.ts?.slice(11,19)||'')+'</div><div class="AN">'+(a.tp||'')+' '+((a.cf||0).toFixed(0))+'%</div><div class="AP">SPX:'+(a.sp?.toFixed(2)||'--')+' GEX:'+(a.gex?(a.gex/1e6).toFixed(1)+'M':'--')+'</div>';
al.appendChild(e)});
});
</script></body></html>"""

# ═══════════════════════════════════════════════════════════════════════════════
# APP
# ═══════════════════════════════════════════════════════════════════════════════
def app(cfg=None):
    a=Flask(__name__);a.config['SECRET_KEY']=os.urandom(24).hex()
    sio=SocketIO(a,cors_allowed_origins="*",async_mode='threading')
    cfg=cfg or Cfg();eng=Eng(cfg)
    
    @a.route('/')
    def idx():return render_template_string(HTML)
    
    @a.route('/cal')
    def cal():return jsonify(CL.analyze())
    
    @a.route('/api/history')
    def history():
        date = request.args.get('date')
        summary = eng.db.get_session_summary(date)
        return jsonify(summary or {})
    
    @a.route('/api/dates')
    def dates():
        return jsonify(eng.db.get_available_dates())
    
    return a,sio,eng

def main():
    print("═"*60+"\n  TITAN OMEGA - HOLY GRAIL\n  SPX Dealer Flow Engine\n"+"═"*60)
    print(f"\n{'✅'if os.environ.get('POLYGON_API_KEY')else'⚠️'} API: {'OK'if os.environ.get('POLYGON_API_KEY')else'export POLYGON_API_KEY=...'}")
    
    mkt_status, mkt_mode = MKT.get_status()
    print(f"📊 Market: {mkt_status}")
    print(f"🌐 http://localhost:5000\n")
    
    cfg=Cfg();a,sio,eng=app(cfg)
    def shut(*_):print("\n🛑");eng.stop();sys.exit(0)
    sg.signal(sg.SIGINT,shut);sg.signal(sg.SIGTERM,shut)
    eng.start(sio);sio.run(a,host=cfg.H,port=cfg.P,debug=False,use_reloader=False,allow_unsafe_werkzeug=True)

if __name__=='__main__':main()
