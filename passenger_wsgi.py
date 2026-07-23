import os
import sys
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent
VENV_DIR = Path("/var/www/u3586612/data/tutu_env")
VENV_PYTHON = Path("/var/www/u3586612/data/tutu_env/bin/python")

if VENV_PYTHON.exists() and Path(sys.prefix).resolve() != VENV_DIR.resolve():
    os.execl(str(VENV_PYTHON), str(VENV_PYTHON), *sys.argv)

sys.path.insert(0, str(PROJECT_DIR))

from a2wsgi import ASGIMiddleware
from back.main import app as asgi_app


application = ASGIMiddleware(asgi_app, wait_time=120.0)
