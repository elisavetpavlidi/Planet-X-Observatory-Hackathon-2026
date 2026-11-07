"""Object selection and cautious, source-level astrometric measurements."""
from __future__ import annotations
import numpy as np
from scipy import ndimage
from astropy.coordinates import SkyCoord
from astropy import units as u
from .processing import registration_operator


def source_peaks(epoch,threshold=5.,limit=80):
    good=epoch.good
    background=float(np.median(epoch.image[good]))
    image=np.where(good,epoch.image,background)
    smooth=ndimage.gaussian_filter(image-background,1.)
    local=(smooth==ndimage.maximum_filter(smooth,size=5)) & good
    local &= (epoch.image-background)/np.sqrt(np.maximum(epoch.variance,1e-20))>threshold
    yy,xx=np.where(local)
    order=np.argsort(smooth[yy,xx])[::-1][:limit]
    return [(int(xx[i]),int(yy[i])) for i in order]


def centroid(epoch,x,y,radius=3):
    ny,nx=epoch.image.shape
    if not np.isfinite([x,y]).all() or x<radius or y<radius or x>=nx-radius or y>=ny-radius:return None
    ix,iy=round(x),round(y)
    x0,x1=max(0,ix-6),min(nx,ix+7);y0,y1=max(0,iy-6),min(ny,iy+7)
    data=epoch.image[y0:y1,x0:x1];good=epoch.good[y0:y1,x0:x1];variance=epoch.variance[y0:y1,x0:x1]
    yy,xx=np.indices(data.shape);xx=xx+x0;yy=yy+y0
    distance=np.hypot(xx-x,yy-y);core=distance<=radius;annulus=(distance>=4)&(distance<=6)&good
    if not good[iy-y0,ix-x0] or good[core].mean()<.9 or annulus.sum()<10:return None
    background=float(np.median(data[annulus]));weights=np.where(core&good,np.maximum(data-background,0),0)
    total=float(weights.sum())
    if total<=0:return None
    cx=float((weights*xx).sum()/total);cy=float((weights*yy).sum()/total)
    v=np.where(core&good,variance,0.)
    snr=float(total/np.sqrt(v.sum()))
    if snr<5:return None
    err=float(np.sqrt((v*((xx-cx)**2+(yy-cy)**2)).sum())/total)
    sky=epoch.wcs.pixel_to_world(cx,cy)
    return {'x':cx,'y':cy,'ra_deg':float(sky.ra.deg),'dec_deg':float(sky.dec.deg),
            'snr':snr,'centroid_error_pixels':err,'aperture_signal':total}


def _stamp(epoch,x,y):
    x,y=round(x),round(y)
    if x<4 or y<4 or x>=epoch.image.shape[1]-4 or y>=epoch.image.shape[0]-4:return None
    a=epoch.image[y-4:y+5,x-4:x+5].copy()
    good=epoch.good[y-4:y+5,x-4:x+5]
    if good.mean()<.8:return None
    a=np.where(good,a,np.median(a[good]))
    if not np.isfinite(a).all():return None
    a=a-np.median(a);norm=np.linalg.norm(a)
    return a/norm if norm>0 else None


def track_selection(epochs,selection,predicted=None):
    """Report possible measurements, not an orbit solution or unconditional detection."""
    if len({e.synthetic for e in epochs})>1:
        return {'status':'insufficient','message':'Δεν αναμειγνύονται πραγματικά και συνθετικά epochs.','measurements':[]}
    ref=epochs[selection['frame']]
    x,y=selection['x'],selection['y']
    candidates=source_peaks(ref)
    if candidates:
        px,py=min(candidates,key=lambda p:np.hypot(p[0]-x,p[1]-y))
        if np.hypot(px-x,py-y)<=4:x,y=px,py
    first=centroid(ref,x,y)
    if first is None:return {'status':'insufficient','message':'Δεν υπάρχει αρκετό έγκυρο σήμα στη θέση που επέλεξες. Δοκίμασε άλλη πηγή.','measurements':[]}
    template=_stamp(ref,first['x'],first['y']);center=SkyCoord(first['ra_deg']*u.deg,first['dec_deg']*u.deg)
    measurements=[];ambiguous=False
    for index,epoch in enumerate(epochs):
        expected=SkyCoord(predicted[index][0]*u.deg,predicted[index][1]*u.deg) if predicted else center
        ex,ey=epoch.wcs.world_to_pixel(expected);ex,ey=float(ex),float(ey)
        if index==selection['frame']:measurement=first
        else:
            matches=[]
            for px,py in source_peaks(epoch):
                distance=float(np.hypot(px-ex,py-ey))
                if distance>(5 if predicted else 18):continue
                stamp=_stamp(epoch,px,py)
                correlation=float((stamp*template).sum()) if stamp is not None and template is not None else 0.
                if correlation>.45:
                    matches.append((correlation-.002*distance,px,py))
            matches.sort(reverse=True)
            if len(matches)>1 and matches[0][0]-matches[1][0]<.04:ambiguous=True
            measurement=centroid(epoch,matches[0][1],matches[0][2]) if matches else None
        if measurement:
            measurement={**measurement,'frame':index,'mjd':float(epoch.header.get('MJD-AVG',epoch.mjd)),
                         'obs_id':epoch.obs_id,'association':'ambiguous' if ambiguous else 'provisional'}
            measurements.append(measurement)
    measurements.sort(key=lambda r:r['mjd'])
    result={'measurements':measurements,'status':'insufficient','message':'Χρειάζονται τουλάχιστον δύο αξιόπιστες μετρήσεις στις εικόνες.','ambiguous_association':ambiguous}
    if len(measurements)<2:return result
    p,q=measurements[0],measurements[-1]
    ca=SkyCoord(p['ra_deg']*u.deg,p['dec_deg']*u.deg);cb=SkyCoord(q['ra_deg']*u.deg,q['dec_deg']*u.deg)
    displacement=float(ca.separation(cb).arcsec)
    def scale(e):return float(np.sqrt(abs(np.linalg.det(e.wcs.pixel_scale_matrix)))*3600)
    ea,eb=epochs[p['frame']],epochs[q['frame']]
    # A conservative 0.5-pixel per-epoch floor is a diagnostic choice, not a fitted astrometric calibration.
    uncertainty=float(np.hypot(scale(ea)*np.hypot(p['centroid_error_pixels'],.5),scale(eb)*np.hypot(q['centroid_error_pixels'],.5)))
    spectral=False
    if ea.wavelength is not None and eb.wavelength is not None:
        ax,ay=round(p['x']),round(p['y']);bx,by=round(q['x']),round(q['y'])
        wa,wb=ea.wavelength[ay,ax],eb.wavelength[by,bx];ba,bb=ea.bandwidth[ay,ax],eb.bandwidth[by,bx]
        spectral=bool(np.isfinite([wa,wb,ba,bb]).all() and abs(wa-wb)<=.25*(ba+bb)/2)
    moving=displacement>max(3*uncertainty,scale(ea))
    result.update(displacement_arcsec=displacement,diagnostic_error_arcsec=uncertainty,
                  spectral_compatible=spectral,elapsed_days=q['mjd']-p['mjd'])
    if ambiguous:result.update(status='uncertain',message='Υπάρχουν περισσότερες από μία πιθανές αντιστοιχίσεις. Η κίνηση δεν ταυτοποιείται με ασφάλεια.')
    elif moving and spectral:result.update(status='possible_motion',message='Υπάρχει πιθανή μετατόπιση στις εικόνες. Χρειάζονται επιπλέον epochs και έλεγχος αστρομετρίας για επιβεβαίωση.')
    elif moving:result.update(status='uncertain',message='Μετρήθηκε αλλαγή θέσης, αλλά τα μήκη κύματος διαφέρουν. Η κίνηση παραμένει ανεπιβεβαίωτη.')
    else:result.update(status='no_resolved_motion',message='Δεν προκύπτει μετρήσιμη μετατόπιση με την ακρίβεια αυτών των εικόνων.')
    return result


def registered_view(reference,epoch):
    operator,_,_=registration_operator(reference,epoch)
    support=np.asarray(operator@epoch.good.ravel().astype(float)).reshape(reference.image.shape)
    image=np.asarray(operator@np.nan_to_num(epoch.image).ravel()).reshape(reference.image.shape)
    valid=support>1-1e-6
    return np.where(valid,image,np.nan),float(valid.mean())
