"""Shared display scaling, unambiguous invalid pixels, offline animated blink."""
from io import BytesIO
import numpy as np
import matplotlib
matplotlib.use("Agg")
from matplotlib import pyplot as plt
from PIL import Image, ImageDraw

BG = "#09111f"
FG = "#dce6f5"
MASK = "#713a78"


def shared_limits(a,b):
    vals=np.concatenate([a[np.isfinite(a)], b[np.isfinite(b)]])
    if not vals.size:
        return 0.,1.
    low,high=np.percentile(vals,[1,99.5])
    return float(low), float(high if high>low else low+1)


def figure(array,title,unit="MJy/sr",limits=None,diverging=False,regions=None,wcs=None):
    fig=plt.figure(figsize=(6,5),facecolor=BG)
    ax=fig.add_subplot(111,projection=wcs) if wcs else fig.add_subplot(111)
    ax.set_facecolor(BG)
    cmap=plt.get_cmap("RdBu_r" if diverging else "magma").with_extremes(bad=MASK)
    if limits is None:
        vals=array[np.isfinite(array)]
        if diverging:
            lim=float(np.percentile(abs(vals),99.5)) if vals.size else 1.
            limits=(-max(lim,1e-8),max(lim,1e-8))
        else:
            limits=shared_limits(array,array)
    im=ax.imshow(np.ma.masked_invalid(array),origin="lower",cmap=cmap,vmin=limits[0],vmax=limits[1],interpolation="nearest")
    ax.set_title(title,color=FG,pad=12,fontsize=12)
    ax.set_xlabel("Right ascension" if wcs else "x [pixel]",color=FG)
    ax.set_ylabel("Declination" if wcs else "y [pixel]",color=FG)
    ax.tick_params(colors=FG,labelsize=8)
    for spine in ax.spines.values():spine.set_color("#30415b")
    if wcs:
        ax.coords[0].set_ticklabel(color=FG,size=8);ax.coords[1].set_ticklabel(color=FG,size=8)
    for candidate in (regions or [])[:20]:
        ax.plot(candidate['x'],candidate['y'],marker='o',mfc='none',mec='#ffe1a0',ms=13,mew=1.1)
    cb=fig.colorbar(im,ax=ax,fraction=.046,pad=.04);cb.ax.tick_params(colors=FG,labelsize=8)
    cb.set_label(unit,color=FG,fontsize=9)
    fig.tight_layout()
    return fig


def png(array,title,**kwargs):
    fig=figure(array,title,**kwargs);b=BytesIO();fig.savefig(b,format='png',dpi=130,facecolor=BG);plt.close(fig)
    return b.getvalue()


def blink_gif(a,b,duration_ms=650,labels=("A","B"),size=560):
    lo,hi=shared_limits(a,b);frames=[]
    for arr,label in zip((a,b),labels):
        valid=np.isfinite(arr)
        normalized=np.arcsinh(6*np.clip((np.nan_to_num(arr,nan=lo)-lo)/(hi-lo),0,1))/np.arcsinh(6)
        rgb=(plt.get_cmap('magma')(normalized)[...,:3]*255).astype('uint8')
        rgb[~valid]=[113,58,120]
        image=Image.fromarray(np.flipud(rgb)).resize((size,round(size*arr.shape[0]/arr.shape[1])),Image.Resampling.NEAREST)
        canvas=Image.new('RGB',(image.width,image.height+40),BG);canvas.paste(image,(0,40))
        ImageDraw.Draw(canvas).text((15,12),str(label),fill='#ffe1a0')
        frames.append(canvas)
    b=BytesIO();frames[0].save(b,format='GIF',save_all=True,append_images=frames[1:],duration=int(duration_ms),loop=0,disposal=2)
    return b.getvalue()
