"""Deterministic, explicitly synthetic end-to-end fixtures. Never NASA observations."""
from io import BytesIO
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS


def make_synthetic_pair(seed=17, shape=(80,96), shift=(0.37,-0.28), motion=True,
              mismatch=False, bad_wcs=False, noise=True):
    rng = np.random.default_rng(seed)
    base = WCS(naxis=2); base.wcs.crpix = [shape[1]/2, shape[0]/2]
    base.wcs.cdelt = [-6.15/3600,6.15/3600]; base.wcs.crval = [10.6847,41.2688]
    base.wcs.ctype = ["RA---TAN","DEC--TAN"]
    # Coordinates refer to A's sky grid; B has a fractional detector displacement.
    sources = [(17.,19.,28.), (69.,16.,38.), (44.,57.,32.), (76.,62.,23.), (29.,40.,25.)]
    output=[]; truth={"seed":seed,"label":"SYNTHETIC INJECTION - NOT NASA OBSERVATIONS", "old_xy":[29,40], "new_xy":[38,35]}
    for index in range(2):
        w = base.deepcopy()
        if index:
            w.wcs.crpix += np.asarray(shift)
        if bad_wcs and index:
            w.wcs.crval += [30,10]
        yy, xx = np.indices(shape,dtype=float)
        # A reference coordinates of each B pixel (exact for translated CRPIX).
        xref, yref = xx-index*shift[0], yy-index*shift[1]
        psig = 1.15 if index==0 else 1.45
        image = np.full(shape,2.+index*.4)
        for j,(x,y,flux) in enumerate(sources):
            if j==4 and index and motion:
                x,y=38.,35.
            image += flux/(2*np.pi*psig**2)*np.exp(-((xref-x)**2+(yref-y)**2)/(2*psig**2))
        sigma=.055 if not index else .07
        if noise:
            image += rng.normal(0,sigma,shape)
        flags=np.zeros(shape,np.int32); flags[4,4]=1<<10; image[4,4]=1000
        header=w.to_header(); header['BUNIT']='MJy/sr'; header['MJD-OBS']=60000+index*180
        header['OBSID']=f'SYNTHETIC-{seed}-{index}'; header['DETECTOR']=4
        header['SYNTHET']=True; header['PSFSIG']=psig
        ph=fits.PrimaryHDU(); ih=fits.ImageHDU(image.astype('f4'),header,name='IMAGE')
        vh=fits.ImageHDU(np.full(shape,sigma**2,dtype='f4'),name='VARIANCE'); vh.header['BUNIT']='MJy2/sr2'
        wave=np.full(shape,2.8+(.5 if mismatch and index else 0),dtype='f4')
        hdul=fits.HDUList([ph,ih,fits.ImageHDU(flags,name='FLAGS'),vh,
                           fits.ImageHDU(wave,name='CWAVE'),fits.ImageHDU(np.full(shape,.08,dtype='f4'),name='CBAND')])
        # FITS checksum comments contain write timestamps; omit them here so
        # identical seeds produce byte-identical input fingerprints on reruns.
        buff=BytesIO();hdul.writeto(buff);output.append(buff.getvalue())
    return output[0],output[1],truth
