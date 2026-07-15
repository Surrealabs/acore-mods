// Temperament.cpp
// Handles custom temperament spell logic for mod-rpgbots

#include "Player.h"
#include "ScriptMgr.h"

class CustomTemperament : public PlayerScript
{
public:
    CustomTemperament() : PlayerScript("CustomTemperament") {}

    // Add custom temperament spell logic here
};

void AddCustomTemperament()
{
    new CustomTemperament();
}
