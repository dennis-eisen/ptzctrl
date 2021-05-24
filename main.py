import asyncio
import json
import logging
import threading

import websockets
from flask import Flask, render_template
from websockets import WebSocketServerProtocol

from constants import TALLY_IDS, CAMERA_IPS, TALLY_HOST, TALLY_PORT, VISCA_UDP_PORT, SERVER_HOST, FLASK_SERVER_PORT, \
    WEBSOCKET_SERVER_PORT, WEB_TITLE
from db import Database
from tally import TallyClient
from visca import CommandSocket, State

logging.basicConfig(level=logging.DEBUG)

CAMERAS = None
TALLY_CLIENTS = None
TALLY_STATES = [0] * len(TALLY_IDS)
DB = Database()
USERS = set()


async def update_button(message: str, data: dict, sender: WebSocketServerProtocol):
    DB.set_button(**data)
    if len(USERS) > 1:  # asyncio.wait doesn't accept an empty list
        logging.debug("Updating users...")
        await asyncio.wait([user.send(message) for user in USERS if user != sender])


async def save_pos(data: dict):
    camera = CAMERAS[data["cam"]]
    focus = await camera.cam_focus_inq()
    DB.set_focus(focus=focus, **data)
    await camera.cam_memory_set(data["pos"])


async def recall_pos(data: dict):
    camera = CAMERAS[data["cam"]]
    focus = DB.get_focus(**data)
    await camera.perform_recall(data["pos"], focus)


async def dispatcher(websocket: WebSocketServerProtocol, _path: str):
    USERS.add(websocket)
    try:
        await websocket.send(json.dumps({
            "event": "init",
            "data": {
                "camera_ips": CAMERA_IPS,
                "all_pos": DB.get_data(),
                "tally_states": TALLY_STATES
            }
        }))
        async for message in websocket:
            message_data = json.loads(message)
            event = message_data["event"]
            data = message_data["data"]
            if event == "update_button":
                await update_button(message, data, websocket)
            elif event == "save_pos":
                await save_pos(data)
            elif event == "recall_pos":
                await recall_pos(data)
            elif event == "focus_lock":
                for camera in CAMERAS:
                    await camera.cam_focus_lock(State.ON)
            elif event == "focus_unlock":
                for camera in CAMERAS:
                    await camera.cam_focus_lock(State.OFF)
            elif event == "power_on":
                for camera in CAMERAS:
                    await camera.cam_power(State.ON)
            elif event == "power_off":
                for camera in CAMERAS:
                    await camera.cam_power(State.OFF)
            else:
                logging.error("Unsupported event: %s with data %s", (event, data))
    finally:
        USERS.remove(websocket)


async def tally_notify(cam: int, state: int):
    TALLY_STATES[cam] = state
    if USERS:
        message = json.dumps({
            "event": "update_tally",
            "data": TALLY_STATES
        })
        await asyncio.wait([user.send(message) for user in USERS])


async def watch_tallies():
    # Tally watcher clients
    tally_clients = [TallyClient(index, num, tally_notify, TALLY_HOST, TALLY_PORT)
                     for index, num in enumerate(TALLY_IDS) if num >= 0]
    for tally_client in tally_clients:
        asyncio.create_task(tally_client.connect())


if __name__ == "__main__":
    # Create flask web server for resource serving
    app = Flask(__name__)

    @app.route('/')
    def root():
        return render_template('index.html', title=WEB_TITLE)

    # Start flask server in separate Thread
    threading.Thread(
        target=app.run,
        kwargs={"use_reloader": False, "host": SERVER_HOST, "port": FLASK_SERVER_PORT},
        daemon=True).start()

    # Init camera controls
    CAMERAS = [CommandSocket(ip, VISCA_UDP_PORT) for ip in CAMERA_IPS]
    # Start WebSocket server
    start_server = websockets.serve(dispatcher, SERVER_HOST, WEBSOCKET_SERVER_PORT)
    asyncio.get_event_loop().run_until_complete(start_server)

    # Start tally state watcher clients
    asyncio.get_event_loop().run_until_complete(watch_tallies())

    # Wait on event loop
    asyncio.get_event_loop().run_forever()