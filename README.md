## Configuration

Add a new platform to your homebridge `config.json`.

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
        ]
      }
    ]
  }
```