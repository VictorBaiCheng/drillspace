# MyDrill DLL / JNI Bridge Notes

`cal_wellbore.dll` 是旧 MyDrill/well-path 的 JNI DLL，不是普通 C ABI DLL。
它导出的函数是 JNI 形式，例如：

- `Java_com_hchl_well_util_calWell_CalWellBoreUtil_Jwellbore_1Main`
- `Java_com_hchl_well_util_calWell_CalWellBoreUtil_WellPath_1Table`
- `Java_com_hchl_well_util_calWell_CalWellBoreUtil_SurfaceCal`
- `Java_com_hchl_well_util_calWell_CalWellBoreUtil_FlatScanningCal`

因此 Python `ctypes` 不能直接按普通 DLL 函数调用，推荐两种方式：

1. 先在旧 MyDrill/well-path 中导出 CSV 结果，再用 V2.8.9 的校准接口对齐；
2. 后续做 Java Bridge，小 Java 程序加载 `cal_wellbore.dll`，输出 JSON/CSV，再由 FastAPI 读取。

本包没有携带旧系统 DLL。请把你本地旧工程中的 DLL 放到：
`backend/legacy_reference/lib/cal_wellbore.dll`
