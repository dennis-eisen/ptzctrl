"use strict";

jQuery(() => {
    (($) => {
        $.new = (elementType) => {
            return $(document.createElement(elementType));
        };

        // Event handler for persistent (client-side) On Air Change setting
        $("#button-on-air-change-group").on("click", "input", 
            (event) => window.localStorage.setItem("onAirChangeState", event.target.value));
        (() => {
            const onAirChangeState = window.localStorage.getItem("onAirChangeState") || "off";
            $("#button-on-air-change-group input[value=" + onAirChangeState + "]").click();
        })();

        // WebSocket creation, using the hostname from the GUI
        const webSocket = new WebSocket("ws://" + window.location.hostname + ":6789/");
        // Main wrapper element for all buttons
        const ptzWrapper = $("#ptz-wrapper");
        // Map of header elements
        const ptzHeaders = {};
        // References for Bootstrap Modal for label and color
        const labelModal = $("#label-modal");
        const bsLabelModal = new bootstrap.Modal(labelModal.get(0));
        const labelModalSave = $("#label-modal-save");
        const labelModalSaveSet = $("#label-modal-save-set");
        const labelInput = $("#label-input");
        // Create the column div for one PTZ camera
        const makePtzCol = (index, ip, tallyState) => {
            const header = $
                .new("h1")
                .text("PTZ " + (index + 1));
            ptzHeaders[index] = header;
            updatePtzHeader(index, tallyState);
            const col = $
                .new("div")
                .attr("class", "col px-4")
                .append(header)
                .append($.new("h2").text(ip))
                .appendTo(ptzWrapper);
            return $
                .new("div")
                .attr("class", "row")
                .appendTo(col);
        };
        // Update PTZ header with tally state
        const updatePtzHeader = (index, state) => {
            const TALLY_CLASSES = {
                0: "",
                1: "btn-success",  // Preview
                2: "btn-danger"  // Program
            };
            const header = ptzHeaders[index];
            header.attr("class", TALLY_CLASSES[state]);
        };
        // Create one button from the row data
        const makePtzButton = (row) => {
            return $
                .new("div")
                .attr("class", "col-12 col-lg-6 col-xxl-4 p-2")
                .append($
                    .new("button")
                    .attr({
                        "type": "button",
                        "id": "button-" + row["cam"] + "-" + row["pos"],
                        "class": "btn btn-lg ptz-button shadow-none " + row["btn_class"]
                    })
                    .text(row["name"])
                    .data(row));
        };
        // Update button, finding it in DOM if neccessary
        const updateButton = (data, button) => {
            if (button === undefined) {
                button = $("#button-" + data["cam"] + "-" + data["pos"]);
            }
            const oldClass = button.data("btn_class");
            data = $.extend(button.data(), data);
            button
                .data(data)
                .removeClass(oldClass)
                .addClass(data["btn_class"])
                .text(data["name"]);
            return data;
        };
        // Send over WebSocket
        const wsSend = (eventName, data) => {
            webSocket.send(JSON.stringify({
                "event": eventName,
                "data": data
            }));
        };
        const sendOnOff = (value, onEvent, offEvent) => {
            if (value == "on") {
                wsSend(onEvent, null);
            } else if (value == "off") {
                wsSend(offEvent, null);
            } else {
                console.error("WTF is this?");
            }
        };
        // Functions for signaling and saving
        const body = $(document.body);
        const flashBackground = (animation, durationMs) => {
            if (durationMs === undefined) {
                durationMs = 500;
            }
            body.css("animation", animation + " " + (durationMs/1000).toFixed(3) + "s ease-in-out")
            setTimeout(() => body.css("animation", ""), durationMs);
        };
        const savePos = (data) => {
            wsSend("save_pos", {
                "cam": data["cam"],
                "pos": data["pos"]
            });
            flashBackground("pulse-green");
        };

        // WebSocket message handling
        webSocket.onmessage = (message) => {
            const messageData = JSON.parse(message.data);
            const event = messageData.event;
            const data = messageData.data;
            console.log(event, data);
            switch (event) {
                case "init":
                    const cameraIps = data["camera_ips"];
                    const posData = data["all_pos"];
                    const tallyStates = data["tally_states"];
                    let cam = null;
                    let col = null;
                    ptzWrapper.empty();
                    posData.forEach((row) => {
                        if (row["cam"] !== cam) {
                            cam = row["cam"];
                            col = makePtzCol(cam, cameraIps[cam], tallyStates[cam]);
                        }
                        col.append(makePtzButton(row));
                    });
                    break;
                case "update_button":
                    updateButton(data);
                    break;
                case "update_tally":
                    data.forEach((state, index) => updatePtzHeader(index, state));
                    break;
                default:
                    console.log("Unknown event: " + event, data);
            }
        };

        // Event handler for clear all
        $("#button-clear-all").click(() => {
            if (confirm("Are you sure you want to RESET ALL LABELS AND COLORS?")) {
                wsSend("clear_all", null);
            }
        });
        // Event handler for power
        $("#button-power-group").on("click", "button", 
            (event) => sendOnOff(event.target.value, "power_on", "power_off"));
        // Event handler for focus lock
        $("#button-focus-lock-group").on("click", "button", 
            (event) => sendOnOff(event.target.value, "focus_lock", "focus_unlock"));
        // Button modes
        const RECALL = "mode_recall";
        const SET = "mode_set";
        const LABEL = "mode_label";
        // Current mode of buttons
        let buttonMode = RECALL;
        // Event handler for button modes
        $("#button-mode-group").on("change", "input", (event) => {
            buttonMode = event.target.value;
        });
        // Menu wrapper buttons active state fix
        $("#menu-wrapper").on("click", "button", (event) => {
            $(event.target).blur();
        });
        // Page-global event handler for modes
        $(document).keyup((event) => {
            if (event.ctrlKey || event.altKey) {
                console.log(event.key);
                switch (event.key) {
                    case "r": case "R": case "ArrowLeft":
                        $("#mode-recall").click();
                        break;
                    case "s": case "S": case "ArrowDown":
                        $("#mode-set").click();
                        break;
                    case "l": case "L": case "ArrowRight":
                        $("#mode-label").click();
                        break;
                }
                event.preventDefault();
            }
        });

        // On Air Change on button
        const onAirChangeOnButton = $("#on-air-change-on");
        // Last button clicked
        let clickedButton = null;
        // Button click listener
        ptzWrapper.on("click", ".ptz-button", (event) => {
            clickedButton = $(event.target);
            const data = clickedButton.data();
            switch (buttonMode) {
                case RECALL:
                    if (ptzHeaders[data["cam"]].hasClass("btn-danger") && !onAirChangeOnButton.is(":checked")) {
                        flashBackground("pulse-red", 300);
                    } else {
                        wsSend("recall_pos", {
                            "cam": data["cam"],
                            "pos": data["pos"]
                        });
                    }
                    break;
                case SET:
                    savePos(data);
                    break;
                case LABEL:
                    $("#btn-class-radios input")
                        .filter((_index, element) => element.value === data["btn_class"])
                        .prop("checked", true);
                    bsLabelModal.show();
                    labelInput.val(data["name"]);
                    break;
            }
        });
        // Modal event listeners
        labelModal.keyup((event) => {
            if (event.key === "Enter") {
                if (event.ctrlKey || event.altKey) {
                    labelModalSaveSet.click();
                } else {
                    labelModalSave.click();
                }
            }
        });
        labelModal.on("shown.bs.modal", () => {
            labelInput.focus();
            labelInput.get(0).setSelectionRange(0, labelInput.val().length)
        });
        labelModalSave.click(() => {
            const newData = updateButton({
                "name": labelInput.val(),
                "btn_class": $("#btn-class-radios input:checked").val()
            }, clickedButton);
            wsSend("update_button", newData);
            clickedButton = null;
            bsLabelModal.hide();
        });
        labelModalSaveSet.click(() => {
            const data = clickedButton.data();
            labelModal.one("hidden.bs.modal", () => savePos(data));
            labelModalSave.click();
        });
    })(jQuery);
});