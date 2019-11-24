# homebridge-yamaha-avr

`homebridge-yamaha-avr` is a Homebridge plugin allowing you to control your AVR & any connected HDMI-CEC controllable devices with the Apple Home app & Control Centre remote! It should work with all network accessible receivers.

The Yamaha AVR will display as a TV Accessory with Power, Input, Volume & Remote Control.

## Requirements
* iOS 12.2 (or later)
* [Homebridge](https://homebridge.io/) v0.4.46 (or later)

## Installation
Install homebridge-yamaha-avr:
```sh
npm install -g homebridge-yamaha-avr
```

## Usage Notes
Quickly switch input using the information (i) button in the Control Centre remote

## Configuration
Add a new platform to your homebridge `config.json`.

You can filter the available inputs that are presented in HomeKit.  The filtering is done on the "id" field, and the "id" must exactly match the name of the input on the receiver.
**NOTE** The receiver may rename inputs, e.g. HDMI1 may become AppleTV.  Use the **NON-RENAMED** input name as the "id".

Example configuration:

```js
{
    "platforms": [
      {
        "platform": "yamaha-avr",
        "name": "Yamaha RX-V685",
        "ip": "192.168.1.12",
        "inputs": [
          {
            "id": "AV1",
            "name": "LG TV"
          },
          {
            "id": "HDMI1",
            "name": "NVIDIA SHIELD"
          },
          {
            "id": "HDMI2",
            "name": "Apple TV"
          },
          {
            "id": "HDMI3",
            "name": "PC"
          },
          {
            "id": "HDMI4",
            "name": "Xbox One"
          },
          {
            "id": "HDMI5",
            "name": "PlayStation 4"
          }
        ],
        "scenes": [
           {
              "name": "Watch AppleTV",
              "index": 1
           }
           {
              "name": "Play PS4",
              "index": 2
           }
        ]
      }
    ]
  }
```

## Other Yamaha Receiver Plugins
[homebridge-yamaha-zone-tv](https://github.com/NorthernMan54/homebridge-yamaha-zone-tv)
For multi-zone Yamaha Receivers, and uses the Television control for each zone of the receiver.

[homebridge-yamaha-home](https://github.com/NorthernMan54/homebridge-yamaha-home)
For multi-zone Yamaha Receivers, and uses a Fan to control each zone of the receiver.
