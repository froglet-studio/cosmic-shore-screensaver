// MinGW has no EventToken.h; WebView2.h only needs this one struct from it. Used by the MinGW
// compile check only (CMakeLists.txt); MSVC builds use the Windows SDK's own header.
#pragma once
typedef struct EventRegistrationToken { __int64 value; } EventRegistrationToken;
