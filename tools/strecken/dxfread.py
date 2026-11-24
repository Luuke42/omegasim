import numpy as np
from scipy.interpolate import BSpline
def lies(fn):
  L=[l.strip() for l in open(fn,errors='replace').read().splitlines()]
  pairs=[(L[i],L[i+1]) for i in range(0,len(L)-1,2)]
  i=[k for k,(c,v) in enumerate(pairs) if c=='2' and v=='ENTITIES'][0]
  ents=[];cur=None
  for c,v in pairs[i+1:]:
    if c=='0':
      if cur: ents.append(cur)
      if v=='ENDSEC': break
      cur={'t':v,'g':[]}
    elif cur is not None: cur['g'].append((c,v))
  segs=[];pts=[]
  for e in ents:
    g=e['g'];t=e['t'];f=lambda code:[float(v) for c,v in g if c==code]
    if t=='LINE': P=np.array([[f('10')[0],f('20')[0]],[f('11')[0],f('21')[0]]])
    elif t=='LWPOLYLINE':
      P=np.c_[f('10'),f('20')]
      fl=[int(v) for c,v in g if c=='70']
      if fl and fl[0]&1: P=np.vstack([P,P[:1]])
    elif t=='SPLINE':
      k=int([v for c,v in g if c=='71'][0]); kn=np.array(f('40')); C=np.c_[f('10'),f('20')]
      P=BSpline(kn,C,k)(np.linspace(kn[k],kn[-k-1],300))
    elif t=='ARC':
      cx,cy,r=f('10')[0],f('20')[0],f('40')[0];a0,a1=f('50')[0],f('51')[0]
      if a1<a0:a1+=360
      w=np.radians(np.linspace(a0,a1,24)); P=np.c_[cx+r*np.cos(w),cy+r*np.sin(w)]
    elif t=='POINT': pts.append((f('10')[0],f('20')[0])); continue
    else: continue
    segs.append(P)
  return segs,pts
