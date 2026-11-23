package Rover_gb {
    private import RecursiveDecompositionPattern::Metadata::*;
    private import Rover_bb::*;

    #graybox part def Rover_gb :> Rover_bb {
        #blackbox part chassis : Chassis_bb;
        #blackbox part drive : Drive_bb;
        #blackbox part power : Power_bb;
        #blackbox part nav : Navigation_bb;

        bind command = nav.command;
        interface drive.supply to power.supply;
    }

    #blackbox part def Chassis_bb;
    #blackbox part def Drive_bb {
        port supply : PowerLine;
    }
    #blackbox part def Power_bb {
        port supply : ~PowerLine;
    }
    #blackbox part def Navigation_bb {
        port command : CommandLink;
    }
    port def PowerLine;
}
