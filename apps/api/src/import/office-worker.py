"""
One LibreOffice kept running for Slider's edit renders (`office-pool.ts`).

Runs inside `soffice` itself, as a script of its profile (`user/Scripts/python`), started with
`vnd.sun.star.script:office-worker.py$serve?language=Python&location=user` – so it needs no
Python of its own (macOS does not let LibreOffice's be started on its own). It connects to the
Unix socket the pool listens on (`SLIDER_OFFICE_SOCKET`) and converts one job per line, answering
one JSON line each:

  in:  {"id": 1, "input": "file:///…/deck.odp", "output": "file:///…/deck.pdf",
        "import": "impress8", "export": "impress_pdf_Export", "pageRange": "3,5"}
  out: {"id": 1, "ok": true}  or  {"id": 1, "ok": false, "error": "…"}

The first line out is {"ready": true}. When the pool closes the socket, LibreOffice quits. The
pool kills the whole process group when a job hangs.

Documents are opened with macros never run and links never updated (`MacroExecutionMode`,
`UpdateDocMode`), on top of the hardened profile and the links Slider drops from the file.
"""

import json
import os
import socket

import uno
from com.sun.star.beans import PropertyValue


def props(**values):
    out = []
    for name, value in values.items():
        prop = PropertyValue()
        prop.Name = name
        prop.Value = value
        out.append(prop)
    return tuple(out)


def convert(desktop, job):
    document = desktop.loadComponentFromURL(
        job["input"],
        "_blank",
        0,
        props(
            Hidden=True,
            ReadOnly=True,
            # The one import filter – no content sniffing into other formats.
            FilterName=job["import"],
            # com.sun.star.document.MacroExecMode.NEVER_EXECUTE, UpdateDocMode.NO_UPDATE.
            MacroExecutionMode=0,
            UpdateDocMode=0,
        ),
    )
    if document is None:
        raise RuntimeError("LibreOffice could not open the file")
    try:
        filter_data = props(PageRange=job["pageRange"]) if job.get("pageRange") else ()
        uno.invoke(
            document,
            "storeToURL",
            (
                job["output"],
                props(
                    FilterName=job["export"],
                    FilterData=uno.Any("[]com.sun.star.beans.PropertyValue", filter_data),
                ),
            ),
        )
    finally:
        document.close(True)


def warm_up(desktop):
    """Draws an empty presentation once, so the first real job finds the PDF export loaded."""
    document = desktop.loadComponentFromURL(
        "private:factory/simpress", "_blank", 0, props(Hidden=True)
    )
    try:
        output = os.path.join(os.path.dirname(os.environ["SLIDER_OFFICE_SOCKET"]), "warm-up.pdf")
        document.storeToURL(
            uno.systemPathToFileUrl(output), props(FilterName="impress_pdf_Export")
        )
        os.remove(output)
    finally:
        document.close(True)


def serve(*args):
    desktop = XSCRIPTCONTEXT.getDesktop()  # noqa: F821 – given by LibreOffice's script provider
    try:
        warm_up(desktop)
    except Exception:
        pass  # only slower
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        connection.connect(os.environ["SLIDER_OFFICE_SOCKET"])
        stream = connection.makefile("rw", encoding="utf-8", newline="\n")

        def say(message):
            stream.write(json.dumps(message) + "\n")
            stream.flush()

        say({"ready": True})
        for line in stream:
            if not line.strip():
                continue
            job = json.loads(line)
            try:
                convert(desktop, job)
                say({"id": job["id"], "ok": True})
            except Exception as error:  # the pool decides what a failure means
                say({"id": job.get("id"), "ok": False, "error": str(error)[:500]})
    finally:
        connection.close()
        desktop.terminate()


g_exportedScripts = (serve,)
