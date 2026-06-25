package com.hchl.well.util.calWell;

public class CalWellBoreUtil {
    public native int Jwellbore_Main(double L, double[] Mea, int LMD, double[] Value, int[] Count);
    public native int WellPath_Table(double[] mea, int num, double[] value, int[] count1);
    public native int SurfaceCal(double[] md0, double[] inc0, double[] azi0,
                                 double[] md1, double[] inc1, double[] azi1,
                                 double n, double s, double[] dS, double[] dL,
                                 double[] plantMD, double[] plantTVD, int md0cnt, int cnt1);
    public native int FlatScanningCal(double[] md0, double[] inc0, double[] azi0,
                                      double[] md11, double[] inc11, double[] azi11,
                                      double n, double s, int flag,
                                      double[] dL, double[] theta, double[] beta,
                                      int cnt1, int md0cnt, double[] md, double[] inc, double[] azi);
}
