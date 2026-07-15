// Psychology.cpp
// Handles custom psychology spell logic for mod-rpgbots

#include "Player.h"
#include "ScriptMgr.h"

class CustomPsychology : public PlayerScript
{
public:
    CustomPsychology() : PlayerScript("CustomPsychology") {}

    // Add custom psychology spell logic here
};

void AddCustomPsychology()
{
    new CustomPsychology();
}
