package Rover_wb {
    private import RecursiveDecompositionPattern::Metadata::*;
    private import Rover_gb::*;
    private import Chassis_wb::*;
    private import Drive_wb::*;
    private import Power_gb::*;
    private import Navigation_gb::*;

    #whitebox part def Rover_wb :> Rover_gb {
        #whitebox part :>> chassis : Chassis_wb;
        #whitebox part :>> drive : Drive_wb;
        #graybox part :>> power : Power_gb;
        #graybox part :>> nav : Navigation_gb;
    }
}
