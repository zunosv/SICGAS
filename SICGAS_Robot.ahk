; ============================================================
;  SICGAS — Robot de Facturación Oracle Forms
;  AutoHotkey v1  |  Leer facturas.txt y ejecutar en Oracle
;  Presiona ESC en cualquier momento para detener
; ============================================================

#NoEnv
#SingleInstance Force
SetWorkingDir %A_ScriptDir%
SendMode Input

; ── CONFIGURACIÓN ────────────────────────────────────────────
ARCHIVO    := A_ScriptDir . "\facturas.txt"
DELAY_TECLA := 80        ; ms entre cada tecla
DELAY_CAMPO := 120       ; ms al pasar de campo
DELAY_ENTER := 150       ; ms entre Enters del inicio
ORACLE_WIN  := "Oracle Forms Runtime"

; ── TECLA DE PARADA ──────────────────────────────────────────
Esc::
  MsgBox, 48, SICGAS Robot, Robot DETENIDO por el usuario.
  ExitApp
return

; ── INICIO ───────────────────────────────────────────────────
#F10::
  Gosub, IniciarRobot
return

IniciarRobot:
  if !FileExist(ARCHIVO) {
    MsgBox, 16, Error, No se encontró el archivo:`n%ARCHIVO%
    return
  }

  ; Leer todas las líneas del archivo
  FileRead, contenido, %ARCHIVO%
  if (ErrorLevel) {
    MsgBox, 16, Error, No se pudo leer el archivo facturas.txt
    return
  }

  lineas := StrSplit(contenido, "`n", "`r")
  total  := lineas.MaxIndex()

  if (total = 0 || (total = 1 && Trim(lineas[1]) = "")) {
    MsgBox, 48, SICGAS, El archivo facturas.txt está vacío.
    return
  }

  MsgBox, 64, SICGAS Robot, Se procesarán %total% facturas.`n`nAsegúrate de que Oracle Forms Runtime esté abierto y en la pantalla inicial.`n`nPresiona OK para comenzar. Presiona ESC para detener en cualquier momento.

  ; ── PROCESAR CADA LÍNEA ──────────────────────────────────
  Loop, % total
  {
    linea := Trim(lineas[A_Index])
    if (linea = "")
      continue

    partes := StrSplit(linea, ",")
    if (partes.MaxIndex() < 4)
      continue

    bomba  := Trim(partes[1])
    sabor  := Trim(partes[2])
    monto  := Trim(partes[3])
    metodo := Trim(partes[4])

    ; Mostrar progreso en tooltip
    ToolTip, SICGAS · Factura %A_Index% de %total%`nBomba: %bomba%  Sabor: %sabor%`nMonto: $%monto%  Método: %metodo%

    ; Verificar que Oracle esté activo
    Gosub, ActivarOracle

    ; ── SECUENCIA INICIAL (6 Enters + código de módulo) ──
    Gosub, SecuenciaInicio

    ; ── DATOS DE FACTURA ─────────────────────────────────
    Gosub, IngresarDatos

    ; ── GUARDAR SEGÚN MÉTODO ─────────────────────────────
    if (metodo = "E")
      Gosub, GuardarEfectivo
    else if (metodo = "B")
      Gosub, GuardarBAC

    ; ── ESPERAR CHROME Y VOLVER A ORACLE ─────────────────
    Gosub, EsperarChromeYVolver

    ; Pequeña pausa antes de la siguiente factura
    Sleep, 500
  }

  ToolTip
  MsgBox, 64, SICGAS Robot, ✅ Proceso completado.`n%total% facturas procesadas.
return

; ============================================================
;  SUBRUTINAS
; ============================================================

; ── ACTIVAR ORACLE ───────────────────────────────────────────
ActivarOracle:
  if !WinExist(ORACLE_WIN) {
    MsgBox, 16, Error, No se encontró la ventana "%ORACLE_WIN%".`nDetente y verifica que Oracle esté abierto.
    ExitApp
  }
  WinActivate, %ORACLE_WIN%
  WinWaitActive, %ORACLE_WIN%,, 10
  Sleep, 200
return

; ── SECUENCIA DE INICIO (desde pantalla inicial) ─────────────
SecuenciaInicio:
  ; 7 Enters para avanzar por las pantallas iniciales
  Loop, 7 {
    Send, {Enter}
    Sleep, %DELAY_ENTER%
  }

  ; Código 172
  Send, 172
  Sleep, %DELAY_CAMPO%
  Send, {Enter}
  Sleep, %DELAY_ENTER%

  ; Código 2710
  Send, 2710
  Sleep, %DELAY_CAMPO%
  Send, {Enter}
  Sleep, %DELAY_ENTER%
  Send, {Enter}
  Sleep, %DELAY_ENTER%
return

; ── INGRESAR DATOS DE FACTURA ────────────────────────────────
IngresarDatos:
  ; Bomba
  Send, %bomba%
  Sleep, %DELAY_CAMPO%
  Send, {Enter}
  Sleep, %DELAY_CAMPO%

  ; Sabor (S / R / D)
  Send, %sabor%
  Sleep, %DELAY_CAMPO%
  Send, {Enter}
  Sleep, %DELAY_CAMPO%

  ; Monto
  Send, %monto%
  Sleep, %DELAY_CAMPO%
return

; ── GUARDAR EFECTIVO (método E) ──────────────────────────────
GuardarEfectivo:
  ; Después del monto: 3 Enters
  Loop, 3 {
    Send, {Enter}
    Sleep, %DELAY_ENTER%
  }

  ; Tipo de pago: E
  Send, E
  Sleep, %DELAY_TECLA%
  Send, {Enter}
  Sleep, %DELAY_ENTER%

  ; 4 Enters finales para guardar
  Loop, 4 {
    Send, {Enter}
    Sleep, %DELAY_ENTER%
  }
return

; ── GUARDAR BAC TARJETA (método B) ──────────────────────────
GuardarBAC:
  ; Después del monto: 2 Enters
  Loop, 2 {
    Send, {Enter}
    Sleep, %DELAY_ENTER%
  }

  ; Tres T para navegar al campo tarjeta
  Send, T
  Sleep, %DELAY_TECLA%
  Send, T
  Sleep, %DELAY_TECLA%
  Send, T
  Sleep, %DELAY_CAMPO%
  Send, {Enter}
  Sleep, %DELAY_ENTER%

  ; Banco: B
  Send, B
  Sleep, %DELAY_TECLA%
  Send, {Enter}
  Sleep, %DELAY_ENTER%

  ; Confirmar: B
  Send, B
  Sleep, %DELAY_TECLA%
  Send, {Enter}
  Sleep, %DELAY_ENTER%

  ; 4 Enters finales para guardar
  Loop, 4 {
    Send, {Enter}
    Sleep, %DELAY_ENTER%
  }
return

; ── ESPERAR CHROME Y VOLVER A ORACLE ─────────────────────────
EsperarChromeYVolver:
  ; Esperar hasta 15 seg a que Chrome se active
  chromeActivo := false
  Loop, 30 {
    if WinExist("ahk_exe chrome.exe") || WinExist("Google Chrome") {
      chromeActivo := true
      break
    }
    Sleep, 500
  }

  ; Si Chrome apareció, esperar 2 seg y volver con Alt+Tab
  if (chromeActivo) {
    Sleep, 2000
    Send, !{Tab}
    Sleep, 600
  }

  ; Asegurar que Oracle quede al frente
  Gosub, ActivarOracle
return
